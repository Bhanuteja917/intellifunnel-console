import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { getAssetPerformanceReport } from "@/lib/reporting/engagement";
import { defaultDateRange } from "@/lib/reporting/shared";

async function setupPlacement(db: ReturnType<typeof testDb>, clientOrgId: string) {
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}-${Math.random()}`, name: "Test Channel", funnelStageId: stage.id,
      pricingUnit: "CPL", requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrgId, name: "Test Campaign", code: `CAM-${Date.now()}-${Math.random()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });
  const asset = await db.asset.create({
    data: { ownerOrganizationId: clientOrgId, name: "Whitepaper", type: "whitepaper", language: "en", status: "active" },
  });
  const assetVersion = await db.assetVersion.create({
    data: { assetId: asset.id, version: 1, fileName: "wp.pdf", storageKey: "key-1", mimeType: "application/pdf", sizeBytes: 100 },
  });
  return db.assetPlacement.create({
    data: {
      campaignChannelId: channel.id, assetId: asset.id, assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com/a", formSlug: `slug-${Date.now()}-${Math.random()}`, status: "active",
    },
  });
}

describe("getAssetPerformanceReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("sums impressions/conversions across days and computes the conversion rate", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    const placement = await setupPlacement(db, client.id);

    await db.engagementEvent.create({ data: { assetPlacementId: placement.id, date: new Date("2026-08-01"), impressions: 100, conversions: 10 } });
    await db.engagementEvent.create({ data: { assetPlacementId: placement.id, date: new Date("2026-08-02"), impressions: 100, conversions: 20 } });

    const [report] = await getAssetPerformanceReport(db, actor, { dateRange: defaultDateRange(new Date("2026-08-15T00:00:00.000Z")) });
    expect(report).toMatchObject({ assetPlacementId: placement.id, impressions: 200, conversions: 30 });
    expect(report!.conversionRate).toBeCloseTo(0.15);
  });

  it("reports a zero conversion rate for a placement with no engagement data yet", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    await setupPlacement(db, client.id);

    const [report] = await getAssetPerformanceReport(db, actor, { dateRange: defaultDateRange(new Date("2026-08-15T00:00:00.000Z")) });
    expect(report).toMatchObject({ impressions: 0, conversions: 0, conversionRate: 0 });
  });

  it("filters out a placement from another organisation's campaign for a client actor", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const otherClient = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    await setupPlacement(db, otherClient.id);

    const report = await getAssetPerformanceReport(db, actor, { dateRange: defaultDateRange(new Date("2026-08-15T00:00:00.000Z")) });
    expect(report).toEqual([]);
  });
});
