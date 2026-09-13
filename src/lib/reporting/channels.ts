import type { PrismaClient } from "@prisma/client";
import { campaignChannelOrgScopeClause, type Actor } from "@/lib/auth/permissions";
import type { DateRange } from "@/lib/reporting/shared";

export type ChannelPerformanceReport = Array<{
  campaignChannelId: string;
  channelTypeName: string;
  contractedQuantity: number;
  deliveredCount: number;
  reservedCount: number;
  deliveryRunsSuccess: number;
  deliveryRunsFailed: number;
  deliveryRunsExhausted: number;
}>;

export async function getChannelPerformanceReport(
  db: PrismaClient,
  actor: Actor,
  params: { campaignId?: string; dateRange: DateRange },
): Promise<ChannelPerformanceReport> {
  const channels = await db.campaignChannel.findMany({
    where: {
      ...(params.campaignId !== undefined ? { campaignId: params.campaignId } : {}),
      ...campaignChannelOrgScopeClause(actor),
    },
    include: { channelTypeVersion: { include: { channelType: true } } },
  });
  const channelIds = channels.map((c) => c.id);

  const runs = channelIds.length > 0
    ? await db.deliveryRun.groupBy({
        by: ["campaignChannelId", "status"],
        where: {
          campaignChannelId: { in: channelIds },
          createdAt: { gte: params.dateRange.from, lte: params.dateRange.to },
        },
        _count: { _all: true },
      })
    : [];

  return channels.map((c) => {
    const forChannel = runs.filter((r) => r.campaignChannelId === c.id);
    const countFor = (status: string) => forChannel.find((r) => r.status === status)?._count._all ?? 0;
    return {
      campaignChannelId: c.id,
      channelTypeName: c.channelTypeVersion.channelType.name,
      contractedQuantity: c.contractedQuantity,
      deliveredCount: c.deliveredCount,
      reservedCount: c.reservedCount,
      deliveryRunsSuccess: countFor("success"),
      deliveryRunsFailed: countFor("failed"),
      deliveryRunsExhausted: countFor("exhausted"),
    };
  });
}
