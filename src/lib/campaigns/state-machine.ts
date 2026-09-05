import type { ApprovalDecision, Campaign, CampaignStatus, Prisma, PrismaClient } from "@prisma/client";
import { InvalidStateTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { buildConfigSnapshot, SNAPSHOT_VERSION } from "@/lib/campaigns/snapshot";
import { getSetting } from "@/lib/settings/settings";
import { logger } from "@/lib/logging/logger";
import { operatingDayStart } from "@/lib/time/operating-day";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

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

  // Check that channels requiring assets have at least one active placement
  for (const channel of channels) {
    const definition = channel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
    if (definition.requiresAsset) {
      const activeCount = await db.assetPlacement.count({
        where: {
          campaignChannelId: channel.id,
          status: "active",
        },
      });
      if (activeCount === 0) {
        throw new ValidationError(
          `Channel "${definition.name}" requires at least one active asset placement before approval`,
        );
      }
    }
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
        createdById: actor.userId, updatedById: actor.userId,
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
        createdById: actor.userId,
        updatedById: actor.userId,
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

/**
 * Transitions each campaign in its own transaction and keeps going when one
 * fails. A single bad row — a status changed concurrently, a constraint
 * violation — must not stop the rest of the batch, because the worker retries
 * the same batch every tick and would otherwise stall on it forever.
 */
async function transitionEach(
  db: PrismaClient,
  campaigns: Campaign[],
  toStatus: CampaignStatus,
  reason: string,
): Promise<number> {
  let transitioned = 0;
  for (const campaign of campaigns) {
    try {
      await db.$transaction((tx) => applyTransition(tx, null, campaign, toStatus, reason));
      transitioned += 1;
    } catch (error) {
      logger.error("campaign.scheduledTransition.failed", {
        campaignId: campaign.id,
        fromStatus: campaign.status,
        toStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return transitioned;
}

/**
 * Scheduled → Live at flight start. Run by the job runner, so there is no
 * actor. `now` is compared as a calendar day in the platform's operating
 * timezone, since that is the calendar `startDate` was written against.
 */
export async function activateDueCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const due = await db.campaign.findMany({
    where: { status: "scheduled", startDate: { lte: today }, deletedAt: null },
  });

  return transitionEach(db, due, "live", "flight start reached");
}

/**
 * FR-CS-3: auto-complete once the flight's last day has passed in the
 * operating timezone. Quota fulfilment is Phase 3.
 */
export async function completeFinishedCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const finished = await db.campaign.findMany({
    where: { status: { in: ["live", "paused"] }, endDate: { lt: today }, deletedAt: null },
  });

  return transitionEach(db, finished, "completed", "flight end passed");
}
