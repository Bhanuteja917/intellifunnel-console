import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { fireDueWebhookRuns } from "@/lib/delivery/webhook-runner";

async function seedPendingWebhookRun(overrides: { status?: "pending" | "failed"; attemptCount?: number; nextRetryAt?: Date | null } = {}) {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
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
  await db.deliveryConfig.create({
    data: {
      campaignChannelId: channel.id, method: "webhook",
      webhookUrl: "https://example.com/hook", webhookSecret: "shh",
      fieldMappingJson: [{ source: "contact.email", target: "Email" }],
    },
  });
  const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
  const email = normalizeEmail(`lead-${Date.now()}@example.com`);
  const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: (await db.user.create({
      data: { email: normalizeEmail(`u-${Date.now()}@example.com`), name: "U", organizationId: clientOrg.id, status: "active" },
    })).id, mappingJson: {} },
  });
  const lead = await db.lead.create({
    data: {
      campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id,
      accountId: account.id, sourceType: "internal", fieldValuesJson: {}, acceptedAt: new Date(), clientVisible: true,
    },
  });
  const run = await db.deliveryRun.create({
    data: {
      campaignChannelId: channel.id, method: "webhook",
      status: overrides.status ?? "pending",
      attemptCount: overrides.attemptCount ?? 0,
      nextRetryAt: overrides.nextRetryAt,
      leads: { create: { leadId: lead.id } },
    },
  });
  return { db, run };
}

describe("fireDueWebhookRuns", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("marks a run success on a 2xx response and records the sent payload", async () => {
    const { db, run } = await seedPendingWebhookRun();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const fired = await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    expect(fired).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example.com/hook");
    expect((options as RequestInit).headers).toMatchObject({ "X-Delivery-Run-Id": run.id });

    const updated = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("success");
    expect(updated.completedAt).not.toBeNull();
    expect(updated.requestPayloadJson).toEqual({ Email: expect.any(String) });
  });

  it("schedules a backoff retry on a non-2xx response", async () => {
    const { db, run } = await seedPendingWebhookRun();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const now = new Date("2026-01-05T00:00:00.000Z");

    await fireDueWebhookRuns(db, now, fetchImpl as unknown as typeof fetch);

    const updated = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("failed");
    expect(updated.attemptCount).toBe(1);
    expect(updated.lastError).toContain("500");
    expect(updated.nextRetryAt?.getTime()).toBe(now.getTime() + 60_000); // first backoff step: 1 minute
  });

  it("marks a run exhausted once attemptCount reaches maxAttempts", async () => {
    const { db, run } = await seedPendingWebhookRun({ status: "failed", attemptCount: 4 });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    const updated = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("exhausted");
    expect(updated.attemptCount).toBe(5);
    expect(updated.nextRetryAt).toBeNull();
  });

  it("skips a run whose nextRetryAt is still in the future", async () => {
    const future = new Date(Date.now() + 3_600_000);
    const { db, run } = await seedPendingWebhookRun({ status: "failed", attemptCount: 1, nextRetryAt: future });
    const fetchImpl = vi.fn();

    const fired = await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    expect(fired).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const unchanged = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(unchanged.status).toBe("failed");
  });

  it("records a network-error rejection the same way as a non-2xx response", async () => {
    const { db, run } = await seedPendingWebhookRun();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    const updated = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("failed");
    expect(updated.lastError).toContain("ECONNREFUSED");
  });

  it("marks a run exhausted immediately when its config was deleted or reconfigured away from webhook", async () => {
    const { db, run } = await seedPendingWebhookRun();
    // Simulate the config being reconfigured to csv after the run was created.
    await db.deliveryConfig.update({ where: { campaignChannelId: run.campaignChannelId }, data: { method: "csv", webhookUrl: null, webhookSecret: null, csvScheduleCron: "0 6 * * *" } });
    const fetchImpl = vi.fn();

    const fired = await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    expect(fired).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const updated = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("exhausted");
    expect(updated.lastError).toContain("no longer webhook");
  });

  it("leaves a pending run untouched when its config is merely paused — held for a later tick, not exhausted", async () => {
    const { db, run } = await seedPendingWebhookRun();
    await db.deliveryConfig.update({ where: { campaignChannelId: run.campaignChannelId }, data: { status: "paused" } });
    const fetchImpl = vi.fn();

    const fired = await fireDueWebhookRuns(db, new Date(), fetchImpl as unknown as typeof fetch);

    expect(fired).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const unchanged = await db.deliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(unchanged.status).toBe("pending");
    expect(unchanged.attemptCount).toBe(0);
    expect(unchanged.lastError).toBeNull();
  });
});
