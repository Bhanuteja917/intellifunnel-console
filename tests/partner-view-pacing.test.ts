import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { getAllocationsForPartner } from "@/lib/allocations/partner-view";

describe("getAllocationsForPartner — pacing", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("includes deliveredCount and a pace signal for the partner's own active allocation", async () => {
    const db = testDb();
    const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
    const partnerUser = await createUser(db, partnerOrg.id, "PARTNER_ADMIN");
    const actor = await loadActor(db, partnerUser.id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const channelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: { name: "Test Channel", funnelStageCode: "MOFU" }, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity: 100, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    await db.partnerAllocation.create({
      data: {
        campaignChannelId: channel.id, partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 10, deliveredCount: 3, reservedCount: 1,
        payoutRateMinor: 500n, payoutCurrency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });

    const [view] = await getAllocationsForPartner(db, actor);
    expect(view!.deliveredCount).toBe(3);
    expect(["behind", "onPace", "ahead"]).toContain(view!.pace);
  });
});
