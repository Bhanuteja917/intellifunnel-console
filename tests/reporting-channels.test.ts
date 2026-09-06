import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { getChannelPerformanceReport } from "@/lib/reporting/channels";
import { defaultDateRange } from "@/lib/reporting/shared";

async function setupChannel(db: ReturnType<typeof testDb>, clientOrgId: string) {
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
  return db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      deliveredCount: 4, reservedCount: 2,
    },
  });
}

describe("getChannelPerformanceReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("reports contracted/delivered/reserved and delivery run counts by status", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    const channel = await setupChannel(db, client.id);

    await db.deliveryRun.create({ data: { campaignChannelId: channel.id, method: "webhook", status: "success" } });
    await db.deliveryRun.create({ data: { campaignChannelId: channel.id, method: "webhook", status: "success" } });
    await db.deliveryRun.create({ data: { campaignChannelId: channel.id, method: "webhook", status: "failed" } });

    const [report] = await getChannelPerformanceReport(db, actor, { dateRange: defaultDateRange() });

    expect(report).toMatchObject({
      campaignChannelId: channel.id,
      contractedQuantity: 10, deliveredCount: 4, reservedCount: 2,
      deliveryRunsSuccess: 2, deliveryRunsFailed: 1, deliveryRunsExhausted: 0,
    });
  });

  it("filters out a channel from another organisation for a client actor", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const otherClient = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    await setupChannel(db, otherClient.id);

    const report = await getChannelPerformanceReport(db, actor, { dateRange: defaultDateRange() });
    expect(report).toEqual([]);
  });
});
