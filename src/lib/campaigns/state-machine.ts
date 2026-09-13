import type {
  ApprovalDecision,
  Campaign,
  CampaignChannel,
  CampaignChannelStatus,
  CampaignStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { getSetting } from "@/lib/settings/settings";
import { logger } from "@/lib/logging/logger";
import { operatingDayStart } from "@/lib/time/operating-day";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import type { StepConfig } from "@/lib/channels/readiness";
import { decideChannelApproval as recordChannelApproval } from "@/lib/approvals/decisions";

/** SRS §5.1 — campaign-level allowed transitions (manual overrides only; most status changes are derived). */
export const ALLOWED_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft:     ["cancelled"],
  pending:   ["cancelled"],
  scheduled: ["cancelled"],
  live:      ["paused", "completed"],
  paused:    ["live", "completed"],
  completed: [],
  cancelled: [],
};

/**
 * Priority-ordered derivation of campaign status from its channels.
 * Written as a pure function for testability.
 *
 * Rules (evaluated in priority order):
 *   1. Any channel live   → live
 *   2. Any channel draft  → draft
 *   3. Any channel pending → pending
 *   4. All completed/cancelled → completed
 *   5. All paused/completed/cancelled → paused
 *   6. All scheduled/completed/cancelled → scheduled
 *   7. Mixed (e.g. some scheduled + some paused) → paused
 *   8. No channels → draft
 */
export function deriveCampaignStatus(statuses: CampaignChannelStatus[]): CampaignStatus {
  if (statuses.length === 0) return "draft";
  if (statuses.some((s) => s === "live")) return "live";
  if (statuses.some((s) => s === "draft")) return "draft";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "completed" || s === "cancelled")) return "completed";
  if (statuses.every((s) => s === "paused" || s === "completed" || s === "cancelled")) return "paused";
  if (statuses.every((s) => s === "scheduled" || s === "completed" || s === "cancelled")) return "scheduled";
  // Mixed (e.g. some scheduled + some paused) — treat as paused
  return "paused";
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Recomputes campaign status from its channels and persists it.
 * Called after every channel status transition.
 */
export async function updateCampaignStatus(
  db: Db,
  campaignId: string,
  actor: Actor | null,
): Promise<void> {
  const channels = await db.campaignChannel.findMany({
    where: { campaignId },
    select: { status: true },
  });
  const derived = deriveCampaignStatus(channels.map((c) => c.status));

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status === derived) return;

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: derived, updatedById: actor?.userId },
  });
  await db.campaignStatusHistory.create({
    data: {
      campaignId,
      fromStatus: campaign.status,
      toStatus: derived,
      changedByUserId: actor?.userId ?? null,
      reason: "derived from channel status change",
    },
  });
}

/** Channel is ready to submit: has ICP, has email lead spec, meets asset requirements. */
async function assertChannelReadyForApproval(db: Db, channelId: string): Promise<void> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: channelId },
    include: { channelTypeVersion: true },
  });

  const icpCount = await db.icpCriterion.count({ where: { campaignChannelId: channelId } });
  if (icpCount === 0) {
    throw new ValidationError("Channel needs at least one ICP criterion before approval");
  }

  const emailSpec = await db.leadFieldSpec.findFirst({
    where: { campaignChannelId: channelId, fieldKey: "email" },
  });
  if (emailSpec === null) {
    throw new ValidationError("Channel needs an 'email' lead field spec before approval");
  }

  const definition = channel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
  const stepConfig = (channel.stepConfigJson ?? {}) as StepConfig;
  if (
    definition.requiresAsset &&
    stepConfig.placement !== "skipped" &&
    stepConfig.placement !== "optional"
  ) {
    const activeCount = await db.assetPlacement.count({
      where: { campaignChannelId: channelId, status: "active" },
    });
    if (activeCount === 0) {
      throw new ValidationError(
        `Channel "${definition.name}" requires at least one active asset placement before approval`,
      );
    }
  }
}

async function loadAccessibleChannel(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
): Promise<CampaignChannel & { campaign: Campaign }> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: true },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  return channel;
}

/** IIF submits a channel for client approval: draft → pending. */
export async function submitChannelForApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:submitInternal");
  const channel = await loadAccessibleChannel(db, actor, campaignChannelId);
  if (channel.status !== "draft") {
    throw new InvalidStateTransitionError(`Channel is ${channel.status}; only a draft channel can be submitted`);
  }
  await assertChannelReadyForApproval(db, campaignChannelId);

  return db.$transaction(async (tx) => {
    const updated = await tx.campaignChannel.update({
      where: { id: campaignChannelId },
      data: { status: "pending", updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "transition:pending",
      before: { status: "draft" },
      after: { status: "pending" },
    });
    await updateCampaignStatus(tx, channel.campaignId, actor);
    return updated;
  });
}

/** Client approves or rejects a channel. Writes ChannelApproval snapshot + transitions channel status. */
export async function decideChannelApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:approveClient");
  const channel = await loadAccessibleChannel(db, actor, campaignChannelId);
  if (channel.status !== "pending") {
    throw new InvalidStateTransitionError(`Channel is ${channel.status}, not awaiting approval`);
  }

  return db.$transaction(async (tx) => {
    // Write the approval record with all three snapshots (inside tx so snapshot and status are atomic)
    await recordChannelApproval(db, actor, { campaignChannelId, decision, comments });

    const toStatus: CampaignChannelStatus =
      decision === "rejected"
        ? "draft"
        : channel.startDate <= new Date()
        ? "live"
        : "scheduled";

    const updated = await tx.campaignChannel.update({
      where: { id: campaignChannelId },
      data: { status: toStatus, updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: `transition:${toStatus}`,
      before: { status: "pending" },
      after: { status: toStatus, decision, comments },
    });
    await updateCampaignStatus(tx, channel.campaignId, actor);
    return updated;
  });
}

/** Manual campaign-level transition (pause, complete, cancel). Campaign status is otherwise derived. */
export async function transitionCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  toStatus: CampaignStatus,
  reason?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);

  if (!ALLOWED_TRANSITIONS[campaign.status].includes(toStatus)) {
    throw new InvalidStateTransitionError(`Campaign cannot move from ${campaign.status} to ${toStatus}`);
  }

  return db.$transaction(async (tx) => {
    const result = await tx.campaign.updateMany({
      where: { id: campaign.id, status: campaign.status },
      data: { status: toStatus, updatedById: actor.userId },
    });
    if (result.count === 0) {
      throw new InvalidStateTransitionError(`Campaign status changed concurrently`);
    }
    const updated = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    await tx.campaignStatusHistory.create({
      data: { campaignId: campaign.id, fromStatus: campaign.status, toStatus, changedByUserId: actor.userId, reason },
    });
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaign.id,
      action: `transition:${toStatus}`,
      before: { status: campaign.status },
      after: { status: toStatus, reason },
    });
    return updated;
  });
}

/** SUPER_ADMIN: revert a scheduled campaign to draft (resets all channels to draft too). */
export async function superAdminRevertToDraft(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  reason?: string,
): Promise<Campaign> {
  if (!actor.roles.includes("SUPER_ADMIN")) {
    throw new ForbiddenError("Only SUPER_ADMIN can revert a scheduled campaign to draft");
  }
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  if (campaign.status !== "scheduled") {
    throw new InvalidStateTransitionError(
      `Campaign is ${campaign.status}; only scheduled campaigns can be reverted to draft`,
    );
  }
  const revertReason = reason ?? "Reverted to draft by SUPER_ADMIN";
  return db.$transaction(async (tx) => {
    // Reset all non-terminal channels to draft
    await tx.campaignChannel.updateMany({
      where: { campaignId, status: { notIn: ["completed", "cancelled"] } },
      data: { status: "draft", updatedById: actor.userId },
    });
    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "draft", updatedById: actor.userId },
    });
    await tx.campaignStatusHistory.create({
      data: { campaignId, fromStatus: "scheduled", toStatus: "draft", changedByUserId: actor.userId, reason: revertReason },
    });
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaignId,
      action: "transition:draft",
      before: { status: "scheduled" },
      after: { status: "draft", reason: revertReason },
    });
    return updated;
  });
}

async function transitionChannels(
  db: PrismaClient,
  channels: { id: string; campaignId: string }[],
  toStatus: CampaignChannelStatus,
  reason: string,
): Promise<number> {
  let transitioned = 0;
  const campaignIds = new Set<string>();
  for (const channel of channels) {
    try {
      await db.$transaction(async (tx) => {
        await tx.campaignChannel.update({
          where: { id: channel.id },
          data: { status: toStatus },
        });
        campaignIds.add(channel.campaignId);
      });
      transitioned += 1;
    } catch (error) {
      logger.error("channel.scheduledTransition.failed", {
        channelId: channel.id,
        toStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Update campaign status for each affected campaign
  for (const campaignId of campaignIds) {
    try {
      await db.$transaction((tx) => updateCampaignStatus(tx, campaignId, null));
    } catch (error) {
      logger.error("campaign.statusDerivation.failed", { campaignId, error: String(error) });
    }
  }
  return transitioned;
}

/** Scheduled → Live at flight start (channel-level, replaces activateDueCampaigns). */
export async function activateDueChannels(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const due = await db.campaignChannel.findMany({
    where: { status: "scheduled", startDate: { lte: today } },
    select: { id: true, campaignId: true },
  });
  return transitionChannels(db, due, "live", "flight start reached");
}

/** Live/Paused → Completed once end date passes (channel-level). */
export async function completeFinishedChannels(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const finished = await db.campaignChannel.findMany({
    where: { status: { in: ["live", "paused"] }, endDate: { lt: today } },
    select: { id: true, campaignId: true },
  });
  return transitionChannels(db, finished, "completed", "flight end passed");
}
