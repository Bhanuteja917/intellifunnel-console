import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { decideLeadVerification } from "@/lib/leads/verification";

async function setupNeedsReviewLead(options: { withPartnerAllocation: boolean }) {
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

  let partnerOrg: Awaited<ReturnType<typeof createOrganization>> | null = null;
  let allocation: Awaited<ReturnType<typeof db.partnerAllocation.create>> | null = null;
  if (options.withPartnerAllocation) {
    partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
    allocation = await db.partnerAllocation.create({
      data: {
        campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 5, reservedCount: 1, payoutRateMinor: 500n, payoutCurrency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "active",
      },
    });
  }

  const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
  const email = normalizeEmail(`lead-${Date.now()}@example.com`);
  const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
  const submission = await db.leadSubmission.create({
    data: {
      campaignChannelId: campaignChannel.id,
      sourceType: options.withPartnerAllocation ? "partner" : "internal",
      submittedById: reviewer.id,
      partnerOrganizationId: partnerOrg?.id,
      mappingJson: {},
    },
  });
  const lead = await db.lead.create({
    data: {
      campaignChannelId: campaignChannel.id, submissionId: submission.id, contactId: contact.id,
      accountId: account.id, sourceType: options.withPartnerAllocation ? "partner" : "internal",
      verificationStatus: "needsReview", fieldValuesJson: {},
    },
  });

  return { db, lead, campaignChannel, allocation, reviewerActor: await loadActor(db, reviewer.id) };
}

describe("decideLeadVerification — counters", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
    await seedRejectReasons(testDb());
  });

  it("accept converts reservedCount to deliveredCount on both channel and allocation", async () => {
    const { db, lead, campaignChannel, allocation, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: true });
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

    const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updatedChannel.reservedCount).toBe(0);
    expect(updatedChannel.deliveredCount).toBe(1);

    const updatedAllocation = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    expect(updatedAllocation.reservedCount).toBe(0);
    expect(updatedAllocation.deliveredCount).toBe(1);
  });

  it("reject releases reservedCount on both channel and allocation, deliveredCount unchanged", async () => {
    const { db, lead, campaignChannel, allocation, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: true });
    await decideLeadVerification(db, reviewerActor, {
      leadId: lead.id, decision: "reject", rejectReasonCode: "DUPLICATE_IN_CAMPAIGN",
    });

    const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updatedChannel.reservedCount).toBe(0);
    expect(updatedChannel.deliveredCount).toBe(0);

    const updatedAllocation = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    expect(updatedAllocation.reservedCount).toBe(0);
    expect(updatedAllocation.deliveredCount).toBe(0);
  });

  it("an internal-sourced lead's decide only touches the channel counters, no allocation lookup", async () => {
    const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: false });
    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

    const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updatedChannel.reservedCount).toBe(0);
    expect(updatedChannel.deliveredCount).toBe(1);
    // No PartnerAllocation row exists in this branch at all — the function
    // completing without error proves it never dereferences a null allocation.
  });
});
