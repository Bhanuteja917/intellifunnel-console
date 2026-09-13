import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { createAllocation, setAllocationStatus } from "@/lib/allocations/crud";

async function setupChannel() {
  const db = testDb();
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const opsUser = await createUser(db, internalOrg.id, "OPERATIONS");
  const actor = await loadActor(db, opsUser.id);

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
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 100, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });
  return { db, actor, campaignChannel, partnerOrg };
}

function allocationInput(campaignChannelId: string, partnerOrganizationId: string) {
  return {
    campaignChannelId, partnerOrganizationId, allocatedQuantity: 10,
    payoutRate: "5.00", payoutCurrency: "USD",
    startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
  };
}

describe("createAllocation — one active per partner+channel", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("allows the first allocation for a partner on a channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    const created = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    expect(created.id).toBeDefined();
  });

  it("rejects a second non-ended allocation for the same partner+channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    await expect(
      createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows a new allocation once the prior one is ended", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    const first = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    await db.partnerAllocation.update({ where: { id: first.id }, data: { status: "ended" } });
    const second = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    expect(second.id).not.toBe(first.id);
  });
});

describe("setAllocationStatus — one active per partner+channel", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to un-end an allocation when a replacement is already live", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    const first = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    await setAllocationStatus(db, actor, { allocationId: first.id, status: "ended" });
    const second = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    expect(second.status).not.toBe("ended");

    // Without the guard this reaches Task 1's partial unique index and comes
    // back as a raw P2002, not a message the admin status dropdown can show.
    await expect(
      setAllocationStatus(db, actor, { allocationId: first.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const unchanged = await db.partnerAllocation.findUniqueOrThrow({ where: { id: first.id } });
    expect(unchanged.status).toBe("ended");
  });

  it("still allows ending an allocation, and re-activating it once nothing else is live", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    const only = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    // Ending is always safe — the guard only runs for transitions *into* a
    // non-ended status.
    await setAllocationStatus(db, actor, { allocationId: only.id, status: "ended" });
    const revived = await setAllocationStatus(db, actor, { allocationId: only.id, status: "active" });
    expect(revived.status).toBe("active");
  });

  it("allows a status change that leaves the row itself as the only non-ended allocation", async () => {
    // Regression guard on the `id: { not: … }` self-exclusion: without it,
    // an active -> paused change would find *itself* and reject.
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    const only = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
    const paused = await setAllocationStatus(db, actor, { allocationId: only.id, status: "paused" });
    expect(paused.status).toBe("paused");
  });
});
