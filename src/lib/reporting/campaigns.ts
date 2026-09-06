import type { PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, type Actor } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import type { DateRange } from "@/lib/reporting/shared";

export type CampaignPerformanceReport = {
  campaignId: string;
  leadsSubmitted: number;
  leadsAccepted: number;
  leadsRejected: number;
  slaBreachRate: number;
  channels: Array<{
    campaignChannelId: string;
    channelTypeName: string;
    contractedQuantity: number;
    deliveredCount: number;
  }>;
};

export async function getCampaignPerformanceReport(
  db: PrismaClient,
  actor: Actor,
  params: { campaignId: string; dateRange: DateRange },
): Promise<CampaignPerformanceReport> {
  const campaign = await db.campaign.findUnique({ where: { id: params.campaignId } });
  if (campaign === null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);

  const channels = await db.campaignChannel.findMany({
    where: { campaignId: params.campaignId },
    include: { channelTypeVersion: { include: { channelType: true } } },
  });
  const channelIds = channels.map((c) => c.id);

  const leads = channelIds.length > 0
    ? await db.lead.findMany({
        where: {
          campaignChannelId: { in: channelIds },
          createdAt: { gte: params.dateRange.from, lte: params.dateRange.to },
        },
        select: { lifecycleStatus: true, slaBreached: true },
      })
    : [];

  const leadsSubmitted = leads.length;
  const leadsAccepted = leads.filter((l) => l.lifecycleStatus === "accepted").length;
  const leadsRejected = leads.filter((l) => l.lifecycleStatus === "rejected").length;
  const slaBreaches = leads.filter((l) => l.slaBreached).length;

  return {
    campaignId: params.campaignId,
    leadsSubmitted,
    leadsAccepted,
    leadsRejected,
    slaBreachRate: leadsSubmitted === 0 ? 0 : slaBreaches / leadsSubmitted,
    channels: channels.map((c) => ({
      campaignChannelId: c.id,
      channelTypeName: c.channelTypeVersion.channelType.name,
      contractedQuantity: c.contractedQuantity,
      deliveredCount: c.deliveredCount,
    })),
  };
}
