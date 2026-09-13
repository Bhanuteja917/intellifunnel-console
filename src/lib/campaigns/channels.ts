import type { CampaignChannel, CampaignChannelStatus, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit, writeAudit } from "@/lib/audit/audit";
import { assertDraftAndAccessible } from "@/lib/campaigns/crud";
import { toMinorUnits } from "@/lib/money/currency";

export type UpdateCampaignChannelInput = {
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: Date;
  endDate: Date;
};

/**
 * Terms are editable only while both the campaign and the channel are drafts.
 * Editing touches no approval row: the stored snapshot simply stops matching,
 * so the derived status becomes `reapprovalNeeded` on its own.
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

  const clientUnitPriceMinor = toMinorUnits(input.clientUnitPrice, input.currency);
  const costBudgetMinor =
    input.costBudget === undefined || input.costBudget === ""
      ? null
      : toMinorUnits(input.costBudget, input.currency);

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

async function loadAccessibleChannel(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
): Promise<CampaignChannel & { campaign: { status: string; clientOrganizationId: string } }> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: { select: { status: true, clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  return channel;
}

export async function setChannelStatus(
  db: PrismaClient,
  actor: Actor,
  input: { channelId: string; status: CampaignChannelStatus },
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  if (input.status !== "live" && input.status !== "paused") {
    throw new ValidationError(
      `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
    );
  }

  const channel = await loadAccessibleChannel(db, actor, input.channelId);

  if (input.status === "paused" && channel.status !== "live") {
    throw new ValidationError(`Channel is ${channel.status}; only a live channel can be paused`);
  }

  if (input.status === "live" && channel.status === "draft") {
    if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
      throw new ValidationError(
        `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
      );
    }
  }

  const updated = await db.campaignChannel.update({
    where: { id: input.channelId },
    data: { status: input.status, updatedById: actor.userId },
  });

  await writeAudit(db, actor, {
    entityType: "CampaignChannel",
    entityId: input.channelId,
    action: `setStatus:${input.status}`,
    before: { status: channel.status },
    after: { status: input.status },
  });

  return updated;
}
