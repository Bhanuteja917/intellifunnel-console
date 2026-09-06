import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import type { StorageAdapter } from "@/lib/storage/types";
import { generateDueCsvRuns } from "@/lib/delivery/csv-runner";

function fakeStorage(): StorageAdapter & { puts: { key: string; content: Buffer }[] } {
  const puts: { key: string; content: Buffer }[] = [];
  return {
    puts,
    put: vi.fn(async (key: string, content: Buffer) => {
      puts.push({ key, content });
    }),
    getDownloadUrl: vi.fn(async () => "https://example.com/file.csv"),
    delete: vi.fn(async () => {}),
  };
}

async function seedChannelWithAcceptedLeads(acceptedAts: Date[]) {
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
      campaignChannelId: channel.id, method: "csv", csvScheduleCron: "0 6 * * *",
      fieldMappingJson: [{ source: "contact.email", target: "Email" }],
    },
  });
  const user = await db.user.create({
    data: { email: normalizeEmail(`u-${Date.now()}@example.com`), name: "U", organizationId: clientOrg.id, status: "active" },
  });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: user.id, mappingJson: {} },
  });
  for (const acceptedAt of acceptedAts) {
    const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
    const email = normalizeEmail(`lead-${Math.random()}@example.com`);
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
    await db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "internal", fieldValuesJson: {}, clientVisible: true, acceptedAt,
      },
    });
  }
  return { db, channelId: channel.id };
}

describe("generateDueCsvRuns", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("generates a success DeliveryRun covering every clientVisible lead and advances the cursor", async () => {
    const acceptedAt = new Date("2026-01-04T12:00:00.000Z");
    const { db, channelId } = await seedChannelWithAcceptedLeads([acceptedAt]);
    const storage = fakeStorage();
    const now = new Date("2026-01-05T00:30:00.000Z"); // 6:00am IST — matches "0 6 * * *"

    const generated = await generateDueCsvRuns(db, now, storage);

    expect(generated).toBe(1);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.content.toString("utf-8")).toContain("Email");

    const run = await db.deliveryRun.findFirstOrThrow({ where: { campaignChannelId: channelId } });
    expect(run.status).toBe("success");
    expect(run.method).toBe("csv");

    const config = await db.deliveryConfig.findUniqueOrThrow({ where: { campaignChannelId: channelId } });
    expect(config.lastCsvCursorAt?.getTime()).toBe(acceptedAt.getTime());
  });

  it("does not re-include a lead already covered by a prior successful run", async () => {
    const acceptedAt = new Date("2026-01-04T12:00:00.000Z");
    const { db, channelId } = await seedChannelWithAcceptedLeads([acceptedAt]);
    const storage = fakeStorage();

    await generateDueCsvRuns(db, new Date("2026-01-05T00:30:00.000Z"), storage);
    // A day later, same schedule, no new leads.
    const generated = await generateDueCsvRuns(db, new Date("2026-01-06T00:30:00.000Z"), storage);

    expect(generated).toBe(0);
    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: channelId } });
    expect(runs).toHaveLength(1);
  });

  it("skips a config whose cron is not due yet", async () => {
    const { db } = await seedChannelWithAcceptedLeads([new Date("2026-01-04T12:00:00.000Z")]);
    const storage = fakeStorage();
    const notDue = new Date("2026-01-05T05:00:00.000Z"); // 10:30am IST, not 6am

    const generated = await generateDueCsvRuns(db, notDue, storage);

    expect(generated).toBe(0);
    expect(storage.puts).toHaveLength(0);
  });

  it("isolates a per-config failure so one bad config doesn't block the rest of the batch", async () => {
    const acceptedAtA = new Date("2026-01-04T12:00:00.000Z");
    const { db, channelId: channelIdA } = await seedChannelWithAcceptedLeads([acceptedAtA]);
    const acceptedAtB = new Date("2026-01-04T13:00:00.000Z");
    const { channelId: channelIdB } = await seedChannelWithAcceptedLeads([acceptedAtB]);
    const now = new Date("2026-01-05T00:30:00.000Z"); // 6:00am IST — matches "0 6 * * *"

    const storage = fakeStorage();
    // Fail storage.put only for the first config's channel; the second must still succeed.
    storage.put = vi.fn(async (key: string, content: Buffer) => {
      if (key.startsWith(`delivery/${channelIdA}/`)) {
        throw new Error("simulated storage failure");
      }
      storage.puts.push({ key, content });
    });

    const generated = await generateDueCsvRuns(db, now, storage);

    // Only the second (healthy) config's run should count.
    expect(generated).toBe(1);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.key).toContain(channelIdB);

    const runA = await db.deliveryRun.findFirst({ where: { campaignChannelId: channelIdA } });
    expect(runA).toBeNull();
    const configA = await db.deliveryConfig.findUniqueOrThrow({ where: { campaignChannelId: channelIdA } });
    expect(configA.lastCsvCursorAt).toBeNull();

    const runB = await db.deliveryRun.findFirstOrThrow({ where: { campaignChannelId: channelIdB } });
    expect(runB.status).toBe("success");
    const configB = await db.deliveryConfig.findUniqueOrThrow({ where: { campaignChannelId: channelIdB } });
    expect(configB.lastCsvCursorAt?.getTime()).toBe(acceptedAtB.getTime());
  });
});
