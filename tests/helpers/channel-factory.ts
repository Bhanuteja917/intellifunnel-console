import type { CampaignChannelStatus, CampaignStatus, PrismaClient } from "@prisma/client";
import { loadActor, type Actor } from "@/lib/auth/permissions";
import { createOrganization, createUser } from "./factories";

export type ChannelFixture = {
  clientOrgId: string;
  adminActor: Actor;
  clientAdminActor: Actor;
  clientViewerActor: Actor;
  campaignId: string;
  channelId: string;
  channelTypeVersionId: string;
};

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * One campaign with one channel, plus the three actors every approval test
 * needs: an internal admin who configures, a CLIENT_ADMIN who decides, and a
 * CLIENT_VIEWER who must be refused. `requiresAsset` drives the frozen channel
 * type definition, which is what makes the placement setup step apply or not.
 */
export async function createChannelFixture(
  db: PrismaClient,
  options: {
    requiresAsset?: boolean;
    campaignStatus?: CampaignStatus;
    channelStatus?: CampaignChannelStatus;
  } = {},
): Promise<ChannelFixture> {
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true });

  const adminUser = await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER");
  const clientAdminUser = await createUser(db, clientOrg.id, "CLIENT_ADMIN");
  const clientViewerUser = await createUser(db, clientOrg.id, "CLIENT_VIEWER");

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
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
      definitionJson: {
        channelTypeId: channelType.id,
        code: channelType.code,
        name: "Test Channel",
        funnelStageCode: "MOFU",
        producesLeads: true,
        requiresAsset: options.requiresAsset ?? true,
        metricMode: "none",
        allowedMetricFields: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        qualificationFormId: null,
        questions: [],
      },
      publishedById: adminUser.id,
    },
  });

  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "Test Campaign",
      code: `CAM-${unique()}`,
      status: options.campaignStatus ?? "draft",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });

  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 45,
      clientUnitPriceMinor: 2500n,
      currency: "USD",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-03-31"),
      status: options.channelStatus ?? "draft",
    },
  });

  return {
    clientOrgId: clientOrg.id,
    adminActor: await loadActor(db, adminUser.id),
    clientAdminActor: await loadActor(db, clientAdminUser.id),
    clientViewerActor: await loadActor(db, clientViewerUser.id),
    campaignId: campaign.id,
    channelId: channel.id,
    channelTypeVersionId: channelTypeVersion.id,
  };
}
