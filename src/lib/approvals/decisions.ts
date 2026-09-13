import type {
  ApprovalDecision,
  ChannelApproval,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  buildChannelTermsSnapshot,
  buildIcpSnapshot,
  buildLeadSpecSnapshot,
} from "@/lib/approvals/status";

/** A rejection the agency cannot act on is useless; an approval needs no note. */
function normaliseComments(decision: ApprovalDecision, comments: string | undefined): string | null {
  const trimmed = (comments ?? "").trim();
  if (decision === "rejected" && trimmed === "") {
    throw new ValidationError("A change request needs a comment explaining what to change");
  }
  return trimmed === "" ? null : trimmed;
}

/**
 * The client's decision on a channel's commercial terms, ICP, and lead spec.
 * Append-only: a client changing their mind writes another row, and the latest
 * row wins.
 */
export async function decideChannelApproval(
  db: PrismaClient,
  actor: Actor,
  input: { campaignChannelId: string; decision: ApprovalDecision; comments?: string },
): Promise<ChannelApproval> {
  assertPermission(actor, "campaign:approveClient");

  const channel = await db.campaignChannel.findUnique({
    where: { id: input.campaignChannelId },
    include: { campaign: { select: { clientOrganizationId: true, deletedAt: true } } },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const comments = normaliseComments(input.decision, input.comments);

  return db.$transaction(async (tx) => {
    // Re-read inside the transaction so the snapshot and the decision cannot
    // diverge: an edit committing in the gap would otherwise leave the client
    // recorded as having approved terms they never saw (FR-CS-1's reasoning).
    const fresh = await tx.campaignChannel.findUniqueOrThrow({
      where: { id: input.campaignChannelId },
    });

    const icpCriteria = await tx.icpCriterion.findMany({
      where: { campaignChannelId: fresh.id },
    });
    const leadFieldSpecs = await tx.leadFieldSpec.findMany({
      where: { campaignChannelId: fresh.id },
    });

    const approval = await tx.channelApproval.create({
      data: {
        campaignChannelId: fresh.id,
        type: "client",
        decision: input.decision,
        decidedByUserId: actor.userId,
        comments,
        termsSnapshotJson: buildChannelTermsSnapshot(fresh) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: buildIcpSnapshot(icpCriteria) as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: buildLeadSpecSnapshot(leadFieldSpecs) as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    await writeAudit(tx, actor, {
      entityType: "ChannelApproval",
      entityId: approval.id,
      action: input.decision,
      after: { campaignChannelId: fresh.id, decision: input.decision, comments },
    });

    return approval;
  });
}

// Keep old name as alias during transition (removed after Task 9)
export const decideChannelTerms = decideChannelApproval;
