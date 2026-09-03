import type { ApprovalDecision, Campaign, CampaignStatus, Prisma, PrismaClient } from "@prisma/client";
import { InvalidStateTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { buildConfigSnapshot, SNAPSHOT_VERSION } from "@/lib/campaigns/snapshot";

/** SRS §5.1, transcribed exactly. */
export const ALLOWED_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ["pendingInternalApproval", "cancelled"],
  pendingInternalApproval: ["draft", "pendingClientApproval", "cancelled"],
  pendingClientApproval: ["draft", "scheduled", "cancelled"],
  scheduled: ["live", "cancelled"],
  live: ["paused", "completed"],
  paused: ["live", "completed"],
  completed: [],
  cancelled: [],
};

/** Transitions that must go through dedicated approval functions, not transitionCampaign. */
const GATED_TRANSITIONS: ReadonlySet<string> = new Set([
  "draft->pendingInternalApproval",
  "pendingInternalApproval->pendingClientApproval",
  "pendingInternalApproval->draft",
  "pendingClientApproval->scheduled",
  "pendingClientApproval->draft",
]);

async function applyTransition(
  tx: Prisma.TransactionClient,
  actor: Actor | null,
  campaign: Campaign,
  toStatus: CampaignStatus,
  reason: string | undefined,
  extraData: Prisma.CampaignUpdateInput = {},
): Promise<Campaign> {
  if (!ALLOWED_TRANSITIONS[campaign.status].includes(toStatus)) {
    throw new InvalidStateTransitionError(
      `Campaign cannot move from ${campaign.status} to ${toStatus}`,
    );
  }

  // Re-verify the campaign's status hasn't changed since it was read, closing
  // a TOCTOU race between concurrent transitions on the same campaign.
  const result = await tx.campaign.updateMany({
    where: { id: campaign.id, status: campaign.status },
    data: { status: toStatus, updatedById: actor?.userId, ...extraData },
  });
  if (result.count === 0) {
    throw new InvalidStateTransitionError(
      `Campaign status changed concurrently; expected ${campaign.status}`,
    );
  }
  const updated = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });

  await tx.campaignStatusHistory.create({
    data: {
      campaignId: campaign.id,
      fromStatus: campaign.status,
      toStatus,
      changedByUserId: actor?.userId ?? null,
      reason,
    },
  });

  if (actor !== null) {
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaign.id,
      action: `transition:${toStatus}`,
      before: { status: campaign.status },
      after: { status: toStatus, reason },
    });
  }

  return updated;
}

async function loadAccessibleCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  return campaign;
}

export async function transitionCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  toStatus: CampaignStatus,
  reason?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  if (GATED_TRANSITIONS.has(`${campaign.status}->${toStatus}`)) {
    throw new ValidationError(
      `Use submitForInternalApproval/decideInternalApproval/decideClientApproval for ${campaign.status} -> ${toStatus}`,
    );
  }
  return db.$transaction((tx) => applyTransition(tx, actor, campaign, toStatus, reason));
}

/** A campaign is only submittable once it can actually be delivered against. */
async function assertReadyForApproval(db: PrismaClient, campaignId: string): Promise<void> {
  const channels = await db.campaignChannel.findMany({
    where: { campaignId },
    include: { channelTypeVersion: true },
  });
  if (channels.length === 0) {
    throw new ValidationError("A campaign needs at least one channel before approval");
  }

  const criteria = await db.icpCriterion.count({ where: { campaignId } });
  if (criteria === 0) {
    throw new ValidationError("A campaign needs at least one ICP criterion before approval");
  }
}

export async function submitForInternalApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:submitInternal");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  await assertReadyForApproval(db, campaignId);
  return db.$transaction((tx) => applyTransition(tx, actor, campaign, "pendingInternalApproval", undefined));
}

export async function decideInternalApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:approveInternal");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  if (campaign.status !== "pendingInternalApproval") {
    throw new InvalidStateTransitionError(`Campaign is ${campaign.status}, not awaiting internal approval`);
  }

  return db.$transaction(async (tx) => {
    await tx.campaignApproval.create({
      data: {
        campaignId, type: "internal", decision,
        decidedByUserId: actor.userId, comments,
      },
    });
    const toStatus: CampaignStatus = decision === "approved" ? "pendingClientApproval" : "draft";
    return applyTransition(tx, actor, campaign, toStatus, comments);
  });
}

/**
 * The client approval gate. On approval the configuration snapshot is written
 * and the campaign moves to Scheduled (FR-CS-1).
 */
export async function decideClientApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:approveClient");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  if (campaign.status !== "pendingClientApproval") {
    throw new InvalidStateTransitionError(`Campaign is ${campaign.status}, not awaiting client approval`);
  }

  return db.$transaction(async (tx) => {
    // Built inside the transaction so the frozen record and the campaign it
    // freezes cannot diverge: a config write committing between the snapshot
    // and the approval would otherwise land on the live campaign while being
    // absent from what the client is recorded as having approved (FR-CS-1).
    const snapshot = decision === "approved" ? await buildConfigSnapshot(tx, campaignId) : null;

    const approval = await tx.campaignApproval.create({
      data: {
        campaignId,
        type: "client",
        decision,
        decidedByUserId: actor.userId,
        comments,
        configSnapshotJson: snapshot === null ? undefined : (snapshot as unknown as Prisma.InputJsonValue),
        snapshotVersion: snapshot === null ? null : SNAPSHOT_VERSION,
      },
    });

    if (decision === "rejected") {
      return applyTransition(tx, actor, campaign, "draft", comments);
    }

    await tx.campaignChannel.updateMany({ where: { campaignId }, data: { status: "active" } });
    return applyTransition(tx, actor, campaign, "scheduled", comments, {
      approvedSnapshotId: approval.id,
    });
  });
}

/** Scheduled → Live at flight start. Run by the job runner, so there is no actor. */
export async function activateDueCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const due = await db.campaign.findMany({
    where: { status: "scheduled", startDate: { lte: now }, deletedAt: null },
  });

  for (const campaign of due) {
    await db.$transaction((tx) => applyTransition(tx, null, campaign, "live", "flight start reached"));
  }
  return due.length;
}

/** FR-CS-3: auto-complete at the flight end date. Quota fulfilment is Phase 3. */
export async function completeFinishedCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const finished = await db.campaign.findMany({
    where: { status: { in: ["live", "paused"] }, endDate: { lt: now }, deletedAt: null },
  });

  for (const campaign of finished) {
    await db.$transaction((tx) => applyTransition(tx, null, campaign, "completed", "flight end passed"));
  }
  return finished.length;
}
