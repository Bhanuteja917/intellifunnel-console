import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { decideLeadVerification } from "@/lib/leads/verification";

async function setupNeedsReviewLead() {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const reviewer = await createUser(db, internalOrg.id, "QUALITY");

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
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
      reservedCount: 1,
    },
  });

  const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
  const email = normalizeEmail(`lead-${Date.now()}@example.com`);
  const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: campaignChannel.id, sourceType: "internal", submittedById: reviewer.id, mappingJson: {} },
  });
  const lead = await db.lead.create({
    data: {
      campaignChannelId: campaignChannel.id, submissionId: submission.id, contactId: contact.id,
      accountId: account.id, sourceType: "internal", verificationStatus: "needsReview", fieldValuesJson: {},
    },
  });

  return { db, lead, campaignChannel, reviewerActor: await loadActor(db, reviewer.id) };
}

describe("decideLeadVerification — webhook DeliveryRun creation", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedRejectReasons(testDb());
  });

  it("creates a pending webhook DeliveryRun on accept when an active webhook config exists", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead();
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: campaignChannel.id, method: "webhook",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });

    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: campaignChannel.id }, include: { leads: true } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("pending");
    expect(runs[0]!.method).toBe("webhook");
    expect(runs[0]!.leads.map((l) => l.leadId)).toEqual([lead.id]);
  });

  it("creates no DeliveryRun on accept when no delivery config exists", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead();
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: campaignChannel.id } });
    expect(runs).toHaveLength(0);
  });

  it("creates no DeliveryRun on accept when the config is a paused webhook", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead();
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: campaignChannel.id, method: "webhook", status: "paused",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: campaignChannel.id } });
    expect(runs).toHaveLength(0);
  });

  it("creates no DeliveryRun on accept when the config method is csv, not webhook", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead();
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: campaignChannel.id, method: "csv", csvScheduleCron: "0 6 * * *",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: campaignChannel.id } });
    expect(runs).toHaveLength(0);
  });

  it("creates no DeliveryRun on reject", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead();
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: campaignChannel.id, method: "webhook",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "reject", rejectReasonCode: "MISSING_REQUIRED_FIELD" });
    const runs = await db.deliveryRun.findMany({ where: { campaignChannelId: campaignChannel.id } });
    expect(runs).toHaveLength(0);
  });
});
