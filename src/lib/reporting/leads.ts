import type { PrismaClient } from "@prisma/client";
import { campaignChannelOrgScopeClause, type Actor } from "@/lib/auth/permissions";
import type { DateRange } from "@/lib/reporting/shared";

export type LeadBreakdownReport = {
  byVerificationStatus: Record<string, number>;
  byLifecycleStatus: Record<string, number>;
  byRejectReason: Array<{ rejectReasonId: string; code: string; label: string; count: number }>;
};

export async function getLeadBreakdownReport(
  db: PrismaClient,
  actor: Actor,
  params: { campaignId?: string; dateRange: DateRange },
): Promise<LeadBreakdownReport> {
  const leads = await db.lead.findMany({
    where: {
      createdAt: { gte: params.dateRange.from, lte: params.dateRange.to },
      campaignChannel: {
        ...(params.campaignId !== undefined ? { campaignId: params.campaignId } : {}),
        ...campaignChannelOrgScopeClause(actor),
      },
    },
    include: { rejectReason: true },
  });

  const byVerificationStatus: Record<string, number> = {};
  const byLifecycleStatus: Record<string, number> = {};
  const rejectCounts = new Map<string, { code: string; label: string; count: number }>();

  for (const lead of leads) {
    byVerificationStatus[lead.verificationStatus] = (byVerificationStatus[lead.verificationStatus] ?? 0) + 1;
    byLifecycleStatus[lead.lifecycleStatus] = (byLifecycleStatus[lead.lifecycleStatus] ?? 0) + 1;
    if (lead.rejectReason !== null) {
      const existing = rejectCounts.get(lead.rejectReason.id);
      if (existing !== undefined) existing.count += 1;
      else rejectCounts.set(lead.rejectReason.id, { code: lead.rejectReason.code, label: lead.rejectReason.label, count: 1 });
    }
  }

  return {
    byVerificationStatus,
    byLifecycleStatus,
    byRejectReason: [...rejectCounts.entries()].map(([rejectReasonId, v]) => ({ rejectReasonId, ...v })),
  };
}
