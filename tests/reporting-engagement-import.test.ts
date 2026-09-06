import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { importEngagementEvents } from "@/lib/reporting/engagement-import";

async function setupPlacement() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const opsUser = await createUser(db, internal.id, "OPERATIONS");
  const qualityUser = await createUser(db, internal.id, "QUALITY");
  const ops = await loadActor(db, opsUser.id);
  const quality = await loadActor(db, qualityUser.id);

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
      pricingUnit: "CPL", requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: internal.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  const asset = await db.asset.create({
    data: { ownerOrganizationId: internal.id, name: "Whitepaper", type: "whitepaper", language: "en", status: "active" },
  });
  const assetVersion = await db.assetVersion.create({
    data: { assetId: asset.id, version: 1, fileName: "wp.pdf", storageKey: "key-1", mimeType: "application/pdf", sizeBytes: 100 },
  });
  const placement = await db.assetPlacement.create({
    data: {
      campaignChannelId: channel.id, assetId: asset.id, assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com/a", formSlug: `slug-${Date.now()}`, status: "active",
    },
  });

  return { db, ops, quality, placement };
}

describe("importEngagementEvents", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("commits good rows and records a distinct error for an unknown formSlug and a bad number", async () => {
    const { db, ops, placement } = await setupPlacement();
    const content = [
      "formSlug,date,impressions,conversions",
      `${placement.formSlug},2026-08-01,100,10`,
      "unknown-slug,2026-08-01,50,5",
      `${placement.formSlug},2026-08-02,not-a-number,5`,
    ].join("\n");

    const result = await importEngagementEvents(db, ops, { fileContent: content });

    expect(result.rowsAccepted).toBe(1);
    expect(result.rowsFailed).toBe(2);
    expect(result.errors.find((e) => e.rowNumber === 2)?.message).toMatch(/unknown formSlug/i);
    expect(result.errors.find((e) => e.rowNumber === 3)?.field).toBe("impressions");
    expect(await db.engagementEvent.count()).toBe(1);
    expect(await db.importError.count({ where: { batchId: result.batchId } })).toBe(2);
  });

  it("upserts on re-upload instead of duplicating a row for the same placement and date", async () => {
    const { db, ops, placement } = await setupPlacement();
    const first = ["formSlug,date,impressions,conversions", `${placement.formSlug},2026-08-01,100,10`].join("\n");
    const corrected = ["formSlug,date,impressions,conversions", `${placement.formSlug},2026-08-01,150,20`].join("\n");

    await importEngagementEvents(db, ops, { fileContent: first });
    await importEngagementEvents(db, ops, { fileContent: corrected });

    expect(await db.engagementEvent.count()).toBe(1);
    const event = await db.engagementEvent.findFirstOrThrow({ where: { assetPlacementId: placement.id } });
    expect(event.impressions).toBe(150);
    expect(event.conversions).toBe(20);
  });

  it("rejects an actor without report:write", async () => {
    const { db, quality, placement } = await setupPlacement();
    const content = ["formSlug,date,impressions,conversions", `${placement.formSlug},2026-08-01,100,10`].join("\n");
    await expect(importEngagementEvents(db, quality, { fileContent: content })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
