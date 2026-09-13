import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";

async function seedChannel(db: ReturnType<typeof testDb>) {
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
      currency: "USD",
    },
  });
  return db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });
}

describe("delivery schema", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("round-trips a DeliveryConfig and a DeliveryRun with its DeliveryRunLead join row", async () => {
    const db = testDb();
    const channel = await seedChannel(db);

    const config = await db.deliveryConfig.create({
      data: {
        campaignChannelId: channel.id,
        method: "webhook",
        webhookUrl: "https://example.com/hook",
        webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    expect(config.status).toBe("active");

    const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
    const email = normalizeEmail(`lead-${Date.now()}@example.com`);
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
    const submission = await db.leadSubmission.create({
      data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: (await createUser(db, (await createOrganization(db, { isInternal: true, isClient: false })).id, "OPERATIONS")).id, mappingJson: {} },
    });
    const lead = await db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id,
        accountId: account.id, sourceType: "internal", fieldValuesJson: {},
      },
    });

    const run = await db.deliveryRun.create({
      data: { campaignChannelId: channel.id, method: "webhook", leads: { create: { leadId: lead.id } } },
    });
    expect(run.status).toBe("pending");
    expect(run.attemptCount).toBe(0);
    expect(run.maxAttempts).toBe(5);

    const runWithLeads = await db.deliveryRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { leads: true },
    });
    expect(runWithLeads.leads).toHaveLength(1);
    expect(runWithLeads.leads[0]!.leadId).toBe(lead.id);
  });
});
