import type { CampaignChannelStatus, PrismaClient } from "@prisma/client";

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

/**
 * Creates a minimal campaign + channel pair for integration tests.
 * Campaign-level advisory flags (advisoryIcpMatch, advisoryTalMatch) were
 * removed in the channel-level ICP migration — they now live on CampaignChannel
 * and default to false, so no explicit value is needed here.
 */
export async function createCampaignWithChannel(
  db: PrismaClient,
  overrides: Partial<{
    clientOrganizationId: string;
    campaignStatus: "draft" | "pending" | "scheduled" | "live" | "paused" | "completed" | "cancelled";
    channelStatus: CampaignChannelStatus;
    contractedQuantity: number;
    advisoryIcpMatch: boolean;
    advisoryTalMatch: boolean;
  }> = {},
) {
  const stage = await db.funnelStage.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });

  const channelType = await db.channelType.create({
    data: {
      code: `CT-${unique()}`,
      name: "Test Channel",
      funnelStageId: stage.id,
      pricingUnit: "CPL",
      requiresTeleVerification: false,
    },
  });

  const channelTypeVersion = await db.channelTypeVersion.create({
    data: {
      channelTypeId: channelType.id,
      version: 1,
      definitionJson: {},
      publishedById: "system",
    },
  });

  const clientOrganizationId =
    overrides.clientOrganizationId ??
    (
      await db.organization.create({
        data: {
          name: `Client ${unique()}`,
          isClient: true,
          status: "active",
          country: "US",
          defaultBillingCurrency: "USD",
          defaultPayoutCurrency: "USD",
        },
      })
    ).id;

  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId,
      name: `Campaign ${unique()}`,
      code: `CAM-${unique()}`,
      status: overrides.campaignStatus ?? "live",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
    },
  });

  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: overrides.contractedQuantity ?? 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: overrides.channelStatus ?? "live",
      advisoryIcpMatch: overrides.advisoryIcpMatch ?? false,
      advisoryTalMatch: overrides.advisoryTalMatch ?? false,
    },
  });

  return { campaign, campaignChannel, channelTypeVersion };
}
