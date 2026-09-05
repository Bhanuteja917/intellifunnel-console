import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { createAssetPlacement, setPlacementStatus } from "@/lib/assets/placements";

async function setupChannelAndAsset(assetStatus: "draft" | "active" | "archived") {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
  const actor = await loadActor(db, user.id);

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`,
      name: "Test Channel",
      funnelStageId: stage.id,
      pricingUnit: "CPL",
      requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: org.id,
      name: "Test Campaign",
      code: `CAM-${Date.now()}`,
      status: "live",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "active",
    },
  });
  const asset = await db.asset.create({
    data: { ownerOrganizationId: org.id, name: "Test Asset", type: "whitepaper", language: "en", status: assetStatus },
  });
  const assetVersion = await db.assetVersion.create({
    data: { assetId: asset.id, version: 1, fileName: "test.html", storageKey: "test-key", mimeType: "text/html", sizeBytes: 100 },
  });

  return { db, actor, campaignChannel, asset, assetVersion };
}

describe("createAssetPlacement — asset status gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("rejects placing a draft asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("draft");
    await expect(
      createAssetPlacement(db, actor, {
        campaignChannelId: campaignChannel.id,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com",
        formSlug: `slug-${Date.now()}`,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects placing an archived asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("archived");
    await expect(
      createAssetPlacement(db, actor, {
        campaignChannelId: campaignChannel.id,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com",
        formSlug: `slug-${Date.now()}`,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows placing an active asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    expect(placement.assetId).toBe(asset.id);
  });
});

describe("setPlacementStatus — asset status gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("rejects activating a placement whose asset is no longer active", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    await db.asset.update({ where: { id: asset.id }, data: { status: "archived" } });

    await expect(
      setPlacementStatus(db, actor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows pausing regardless of the asset's current status", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    await db.asset.update({ where: { id: asset.id }, data: { status: "archived" } });

    const paused = await setPlacementStatus(db, actor, { placementId: placement.id, status: "paused" });
    expect(paused.status).toBe("paused");
  });
});
