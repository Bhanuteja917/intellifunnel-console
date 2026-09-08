import type { CampaignChannel, CampaignChannelStatus, PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { assertDraftAndAccessible } from "@/lib/campaigns/crud";
import { loadChannelReadiness } from "@/lib/channels/readiness";
import { toMinorUnits } from "@/lib/money/currency";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type UpdateCampaignChannelInput = {
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: Date;
  endDate: Date;
};

/**
 * Terms are editable only while both the campaign and the channel are drafts —
 * the same constraint `addCampaignChannel` enforces. Editing touches no
 * approval row: the stored snapshot simply stops matching, so the derived
 * status becomes `reapprovalNeeded` on its own.
 *
 * `channelTypeVersionId` is deliberately not editable. It carries the frozen
 * question set and the `requiresAsset` flag; swapping it under a configured
 * channel would silently change which setup steps apply.
 */
export async function updateCampaignChannel(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: UpdateCampaignChannelInput,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  const channel = await db.campaignChannel.findUnique({ where: { id: campaignChannelId } });
  if (channel === null) throw new NotFoundError("Channel not found");

  const campaign = await assertDraftAndAccessible(db, actor, channel.campaignId);
  if (channel.status !== "draft") {
    throw new ValidationError(
      `Channel is ${channel.status}; terms can only be edited while it is a draft`,
    );
  }

  if (input.contractedQuantity <= 0) throw new ValidationError("Contracted quantity must be positive");
  if (!Number.isInteger(input.contractedQuantity)) {
    throw new ValidationError("Contracted quantity must be a whole number");
  }
  if (input.currency !== campaign.currency) {
    throw new ValidationError(
      `Channel currency ${input.currency} does not match the campaign's ${campaign.currency}`,
    );
  }
  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Channel end date precedes its start date");
  }
  if (
    input.startDate.getTime() < campaign.startDate.getTime() ||
    input.endDate.getTime() > campaign.endDate.getTime()
  ) {
    throw new ValidationError("Channel window must sit inside the campaign flight window");
  }

  const clientUnitPriceMinor = toMinorUnits(input.clientUnitPrice, input.currency);
  const costBudgetMinor =
    input.costBudget === undefined ? null : toMinorUnits(input.costBudget, input.currency);

  return withAudit<CampaignChannel>(
    db,
    actor,
    {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "update",
      before: {
        contractedQuantity: channel.contractedQuantity,
        clientUnitPriceMinor: channel.clientUnitPriceMinor.toString(),
        startDate: channel.startDate.toISOString().slice(0, 10),
        endDate: channel.endDate.toISOString().slice(0, 10),
      },
      after: {
        contractedQuantity: input.contractedQuantity,
        clientUnitPriceMinor: clientUnitPriceMinor.toString(),
        startDate: input.startDate.toISOString().slice(0, 10),
        endDate: input.endDate.toISOString().slice(0, 10),
      },
    },
    async (tx) => {
      // Re-verify draft status inside the transaction (FR-CS-2): a client
      // approval can commit between the outer check and this write.
      await assertDraftAndAccessible(tx, actor, channel.campaignId);

      return tx.campaignChannel.update({
        where: { id: campaignChannelId },
        data: {
          contractedQuantity: input.contractedQuantity,
          clientUnitPriceMinor,
          costBudgetMinor,
          currency: input.currency,
          startDate: input.startDate,
          endDate: input.endDate,
          updatedById: actor.userId,
        },
      });
    },
  );
}

/**
 * Manual per-channel activation, for operating channels inside a campaign that
 * has already launched. The campaign state machine stays authoritative for
 * launch itself, so this refuses to activate before the campaign is scheduled.
 *
 * Readiness is checked only on the draft -> active hop. Pausing a channel whose
 * terms were edited after activation must stay possible, and so must resuming
 * it.
 */
export async function setChannelStatus(
  db: PrismaClient,
  actor: Actor,
  input: { campaignChannelId: string; status: CampaignChannelStatus },
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  if (input.status !== "active" && input.status !== "paused") {
    throw new ValidationError(
      `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
    );
  }

  const channel = await db.campaignChannel.findUnique({
    where: { id: input.campaignChannelId },
    include: { campaign: { select: { status: true, clientOrganizationId: true, deletedAt: true } } },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  if (input.status === "paused" && channel.status !== "active") {
    throw new ValidationError(`Channel is ${channel.status}; only an active channel can be paused`);
  }

  if (input.status === "active" && channel.status === "draft") {
    if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
      throw new ValidationError(
        `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
      );
    }
    const readiness = await loadChannelReadiness(db, input.campaignChannelId);
    if (!readiness.ready) {
      const outstanding = readiness.steps.filter((s) => s.required && !s.done).map((s) => s.title);
      throw new ValidationError(`Channel setup is incomplete: ${outstanding.join(", ")}`);
    }
  }

  return withAudit<CampaignChannel>(
    db,
    actor,
    {
      entityType: "CampaignChannel",
      entityId: input.campaignChannelId,
      action: "setStatus",
      before: { status: channel.status },
      after: { status: input.status },
    },
    async (tx) =>
      tx.campaignChannel.update({
        where: { id: input.campaignChannelId },
        data: { status: input.status, updatedById: actor.userId },
      }),
  );
}
