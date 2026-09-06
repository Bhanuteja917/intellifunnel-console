import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { listDeliveryRunsForChannel, retryDeliveryRun } from "@/lib/delivery/runs";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function seedChannelWithRun(status: "pending" | "failed" | "success" | "exhausted") {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const operator = await createUser(db, internalOrg.id, "OPERATIONS");
  const quality = await createUser(db, internalOrg.id, "QUALITY");

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
      currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  const run = await db.deliveryRun.create({
    data: { campaignChannelId: channel.id, method: "webhook", status, attemptCount: status === "exhausted" ? 5 : 2, lastError: "boom" },
  });

  return { db, channelId: channel.id, run, operatorActor: await loadActor(db, operator.id), qualityActor: await loadActor(db, quality.id) };
}

describe("delivery runs", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("lists runs for a channel to a delivery:read actor, denies one without it", async () => {
    const { db, channelId, operatorActor, qualityActor } = await seedChannelWithRun("success");
    await expect(listDeliveryRunsForChannel(db, qualityActor, channelId)).rejects.toThrow(ForbiddenError);
    const runs = await listDeliveryRunsForChannel(db, operatorActor, channelId);
    expect(runs).toHaveLength(1);
  });

  it("resets a failed run to pending with attemptCount 0 and no nextRetryAt", async () => {
    const { db, run, operatorActor } = await seedChannelWithRun("failed");
    const retried = await retryDeliveryRun(db, operatorActor, run.id);
    expect(retried.status).toBe("pending");
    expect(retried.attemptCount).toBe(0);
    expect(retried.nextRetryAt).toBeNull();
  });

  it("resets an exhausted run to pending", async () => {
    const { db, run, operatorActor } = await seedChannelWithRun("exhausted");
    const retried = await retryDeliveryRun(db, operatorActor, run.id);
    expect(retried.status).toBe("pending");
  });

  it("refuses to retry a run that is not failed/exhausted", async () => {
    const { db, run, operatorActor } = await seedChannelWithRun("success");
    await expect(retryDeliveryRun(db, operatorActor, run.id)).rejects.toThrow(ValidationError);
  });

  it("denies retry to an actor without delivery:write", async () => {
    const { db, run, qualityActor } = await seedChannelWithRun("failed");
    await expect(retryDeliveryRun(db, qualityActor, run.id)).rejects.toThrow(ForbiddenError);
  });
});
