import type { PrismaClient } from "@prisma/client";
import { campaignChannelOrgScopeClause, type Actor } from "@/lib/auth/permissions";
import type { DateRange } from "@/lib/reporting/shared";

export type AssetPerformanceReport = Array<{
  assetPlacementId: string;
  assetName: string;
  formSlug: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
}>;

export async function getAssetPerformanceReport(
  db: PrismaClient,
  actor: Actor,
  params: { campaignId?: string; dateRange: DateRange },
): Promise<AssetPerformanceReport> {
  const placements = await db.assetPlacement.findMany({
    where: {
      campaignChannel: {
        ...(params.campaignId !== undefined ? { campaignId: params.campaignId } : {}),
        ...campaignChannelOrgScopeClause(actor),
      },
    },
    include: { asset: true },
  });
  const placementIds = placements.map((p) => p.id);

  const events = placementIds.length > 0
    ? await db.engagementEvent.groupBy({
        by: ["assetPlacementId"],
        where: {
          assetPlacementId: { in: placementIds },
          date: { gte: params.dateRange.from, lte: params.dateRange.to },
        },
        _sum: { impressions: true, conversions: true },
      })
    : [];

  return placements.map((placement) => {
    const sums = events.find((e) => e.assetPlacementId === placement.id);
    const impressions = sums?._sum.impressions ?? 0;
    const conversions = sums?._sum.conversions ?? 0;
    return {
      assetPlacementId: placement.id,
      assetName: placement.asset.name,
      formSlug: placement.formSlug,
      impressions,
      conversions,
      conversionRate: impressions === 0 ? 0 : conversions / impressions,
    };
  });
}
