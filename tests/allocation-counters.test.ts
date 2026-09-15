import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization } from "./helpers/factories";
import {
  claimChannelSlot, releaseChannelSlot, convertChannelReservedToDelivered,
  claimAllocationSlot, releaseAllocationSlot, convertAllocationReservedToDelivered,
} from "@/lib/allocations/counters";

async function setupChannelAndAllocation(contractedQuantity: number, allocatedQuantity: number) {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
      producesLeads: true, requiresAsset: false, metricMode: "event",
      allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
      currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });
  const allocation = await db.partnerAllocation.create({
    data: {
      campaignChannelId: channel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity, payoutRateMinor: 500n, payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "active",
    },
  });
  return { db, channel, allocation };
}

describe("allocation counters", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("claims a reserved slot on the channel when under cap", async () => {
    const { db, channel } = await setupChannelAndAllocation(5, 5);
    const claimed = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
    expect(claimed).toBe(true);
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(updated.reservedCount).toBe(1);
    expect(updated.deliveredCount).toBe(0);
  });

  it("refuses to claim once reserved+delivered reaches the cap", async () => {
    const { db, channel } = await setupChannelAndAllocation(1, 1);
    const first = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
    const second = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
    expect(first).toBe(true);
    expect(second).toBe(false);
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(updated.reservedCount).toBe(1);
  });

  it("claims straight into deliveredCount when wantsDelivered is true", async () => {
    const { db, allocation } = await setupChannelAndAllocation(5, 5);
    const claimed = await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, true));
    expect(claimed).toBe(true);
    const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(updated.deliveredCount).toBe(1);
    expect(updated.reservedCount).toBe(0);
  });

  it("releaseAllocationSlot frees a reserved slot", async () => {
    const { db, allocation } = await setupChannelAndAllocation(5, 5);
    await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, false));
    await db.$transaction((tx) => releaseAllocationSlot(tx, allocation.id, false));
    const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(updated.reservedCount).toBe(0);
  });

  it("convertChannelReservedToDelivered moves one unit without changing the total", async () => {
    const { db, channel } = await setupChannelAndAllocation(5, 5);
    await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
    await db.$transaction((tx) => convertChannelReservedToDelivered(tx, channel.id));
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(updated.reservedCount).toBe(0);
    expect(updated.deliveredCount).toBe(1);
  });

  it("convertAllocationReservedToDelivered moves one unit without changing the total", async () => {
    const { db, allocation } = await setupChannelAndAllocation(5, 5);
    await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, false));
    await db.$transaction((tx) => convertAllocationReservedToDelivered(tx, allocation.id));
    const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(updated.reservedCount).toBe(0);
    expect(updated.deliveredCount).toBe(1);
  });
});
