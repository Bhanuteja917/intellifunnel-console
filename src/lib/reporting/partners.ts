import type { PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, type Actor } from "@/lib/auth/permissions";
import type { DateRange } from "@/lib/reporting/shared";

export type PartnerScorecardReport = {
  partnerOrganizationId: string;
  acceptanceRate: number;
  leadsSubmittedPerDay: number;
  rejectReasonBreakdown: Array<{ rejectReasonId: string; code: string; label: string; count: number }>;
  channelBreakdown: Array<{
    campaignChannelId: string;
    channelTypeName: string;
    allocatedQuantity: number;
    deliveredCount: number;
    leadsSubmitted: number;
    leadsAccepted: number;
    leadsRejected: number;
  }>;
};

export async function getPartnerScorecardReport(
  db: PrismaClient,
  actor: Actor,
  params: { partnerOrganizationId: string; dateRange: DateRange },
): Promise<PartnerScorecardReport> {
  assertOrganizationAccess(actor, params.partnerOrganizationId);

  const allocations = await db.partnerAllocation.findMany({
    where: { partnerOrganizationId: params.partnerOrganizationId },
    include: { campaignChannel: { include: { channelTypeVersion: { include: { channelType: true } } } } },
  });

  const leads = await db.lead.findMany({
    where: {
      submission: { partnerOrganizationId: params.partnerOrganizationId },
      createdAt: { gte: params.dateRange.from, lte: params.dateRange.to },
    },
    include: { rejectReason: true },
  });

  const accepted = leads.filter((l) => l.lifecycleStatus === "accepted").length;
  const rejected = leads.filter((l) => l.lifecycleStatus === "rejected").length;
  const days = Math.max(1, Math.ceil((params.dateRange.to.getTime() - params.dateRange.from.getTime()) / 86_400_000));

  const rejectCounts = new Map<string, { code: string; label: string; count: number }>();
  for (const lead of leads) {
    if (lead.rejectReason === null) continue;
    const existing = rejectCounts.get(lead.rejectReason.id);
    if (existing !== undefined) existing.count += 1;
    else rejectCounts.set(lead.rejectReason.id, { code: lead.rejectReason.code, label: lead.rejectReason.label, count: 1 });
  }

  const channelBreakdown = allocations.map((allocation) => {
    const channelLeads = leads.filter((l) => l.campaignChannelId === allocation.campaignChannelId);
    return {
      campaignChannelId: allocation.campaignChannelId,
      channelTypeName: allocation.campaignChannel.channelTypeVersion.channelType.name,
      allocatedQuantity: allocation.allocatedQuantity,
      deliveredCount: allocation.deliveredCount,
      leadsSubmitted: channelLeads.length,
      leadsAccepted: channelLeads.filter((l) => l.lifecycleStatus === "accepted").length,
      leadsRejected: channelLeads.filter((l) => l.lifecycleStatus === "rejected").length,
    };
  });

  return {
    partnerOrganizationId: params.partnerOrganizationId,
    acceptanceRate: accepted + rejected === 0 ? 0 : accepted / (accepted + rejected),
    leadsSubmittedPerDay: leads.length / days,
    rejectReasonBreakdown: [...rejectCounts.entries()].map(([rejectReasonId, v]) => ({ rejectReasonId, ...v })),
    channelBreakdown,
  };
}
