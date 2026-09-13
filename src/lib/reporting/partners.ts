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

  // AUTH-10, same rule `getAllocationsForPartner` documents in
  // src/lib/allocations/partner-view.ts: a partner-facing read is a distinct
  // read model, not the admin query with fields hidden at render time. An
  // `include` here would pull the whole `CampaignChannel` row
  // (`clientUnitPriceMinor`) plus the allocation's own `payoutRateMinor` /
  // `revealClientIdentity` into this process. Only the channel type's name is
  // ever used, so only that is selected — client pricing is structurally
  // absent from the result. `status: "active"` matches the same filter
  // `getAllocationsForPartner` applies, so /partner/scorecard and
  // /partner/allocations show the same allocations rather than the scorecard
  // silently including draft/paused/ended ones.
  const allocations = await db.partnerAllocation.findMany({
    where: { partnerOrganizationId: params.partnerOrganizationId, status: "active" },
    select: {
      campaignChannelId: true,
      allocatedQuantity: true,
      deliveredCount: true,
      campaignChannel: {
        select: { channelTypeVersion: { select: { channelType: { select: { name: true } } } } },
      },
    },
  });

  const leads = await db.lead.findMany({
    where: {
      submission: { partnerOrganizationId: params.partnerOrganizationId },
      createdAt: { gte: params.dateRange.from, lte: params.dateRange.to },
    },
    // Counts only — never pull whole `Lead` rows (`fieldValuesJson` is the
    // submitted form's raw PII payload). Select exactly what is read below.
    select: {
      lifecycleStatus: true,
      campaignChannelId: true,
      rejectReason: { select: { id: true, code: true, label: true } },
    },
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
