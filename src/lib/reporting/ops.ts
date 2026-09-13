import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import type { DateRange } from "@/lib/reporting/shared";

export type OpsDashboardReport = {
  leadsByLifecycleStatus: Record<string, number>;
  slaBreaches: number;
  deliveryFailures: number;
  topRejectReasons: Array<{ rejectReasonId: string; code: string; label: string; count: number }>;
};

export async function getOpsDashboardReport(
  db: PrismaClient,
  actor: Actor,
  params: { dateRange: DateRange },
): Promise<OpsDashboardReport> {
  if (!actor.isInternal) throw new ForbiddenError("Ops dashboard is internal-only");

  // This query is cross-org and platform-wide, so it must never pull whole
  // `Lead` rows: `fieldValuesJson` is the submitted form's raw PII payload and
  // has no business being loaded into an admin dashboard process just to
  // produce counts. Select only the four fields the loop below reads.
  const leads = await db.lead.findMany({
    where: { createdAt: { gte: params.dateRange.from, lte: params.dateRange.to } },
    select: {
      lifecycleStatus: true,
      slaBreached: true,
      rejectReason: { select: { id: true, code: true, label: true } },
    },
  });

  const leadsByLifecycleStatus: Record<string, number> = {};
  const rejectCounts = new Map<string, { code: string; label: string; count: number }>();
  let slaBreaches = 0;
  for (const lead of leads) {
    leadsByLifecycleStatus[lead.lifecycleStatus] = (leadsByLifecycleStatus[lead.lifecycleStatus] ?? 0) + 1;
    if (lead.slaBreached) slaBreaches += 1;
    if (lead.rejectReason !== null) {
      const existing = rejectCounts.get(lead.rejectReason.id);
      if (existing !== undefined) existing.count += 1;
      else rejectCounts.set(lead.rejectReason.id, { code: lead.rejectReason.code, label: lead.rejectReason.label, count: 1 });
    }
  }

  const deliveryFailures = await db.deliveryRun.count({
    where: { status: "failed", createdAt: { gte: params.dateRange.from, lte: params.dateRange.to } },
  });

  const topRejectReasons = [...rejectCounts.entries()]
    .map(([rejectReasonId, v]) => ({ rejectReasonId, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { leadsByLifecycleStatus, slaBreaches, deliveryFailures, topRejectReasons };
}
