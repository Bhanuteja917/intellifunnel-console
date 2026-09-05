import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeEmail } from "@/lib/normalise/email";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { decideLeadVerification } from "@/lib/leads/verification";

async function setupNeedsReviewLead() {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const reviewer = await createUser(db, internalOrg.id, "QUALITY");
  const otherReviewer = await createUser(db, internalOrg.id, "QUALITY");

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`,
      name: "Test Channel",
      funnelStageId: stage.id,
      producesLeads: true,
      requiresAsset: false,
      metricMode: "event",
      allowedMetricFieldsJson: [],
      pricingUnit: "CPL",
      requiresTeleVerification: false,
      currentVersion: 1,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "Test Campaign",
      code: `CAM-${Date.now()}`,
      status: "live",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "active",
    },
  });
  const account = await db.account.create({
    data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") },
  });
  const email = normalizeEmail(`lead-${Date.now()}@example.com`);
  const contact = await db.contact.create({
    data: { accountId: account.id, email, emailNormalized: email },
  });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: campaignChannel.id, sourceType: "internal", submittedById: reviewer.id, mappingJson: {} },
  });
  const lead = await db.lead.create({
    data: {
      campaignChannelId: campaignChannel.id,
      submissionId: submission.id,
      contactId: contact.id,
      accountId: account.id,
      sourceType: "internal",
      verificationStatus: "needsReview",
      fieldValuesJson: {},
    },
  });

  return { db, lead, reviewerActor: await loadActor(db, reviewer.id), otherReviewerActor: await loadActor(db, otherReviewer.id) };
}

describe("decideLeadVerification — assignee check", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("allows deciding an unassigned lead", async () => {
    const { db, lead, reviewerActor } = await setupNeedsReviewLead();
    const result = await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    expect(result.effectiveDecision).toBe("accept");
  });

  it("allows the assignee to decide their own claimed lead", async () => {
    const { db, lead, reviewerActor } = await setupNeedsReviewLead();
    await db.lead.update({ where: { id: lead.id }, data: { assignedToUserId: reviewerActor.userId, assignedAt: new Date() } });
    const result = await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    expect(result.effectiveDecision).toBe("accept");
  });

  it("rejects deciding a lead claimed by a different reviewer", async () => {
    const { db, lead, reviewerActor, otherReviewerActor } = await setupNeedsReviewLead();
    await db.lead.update({ where: { id: lead.id }, data: { assignedToUserId: otherReviewerActor.userId, assignedAt: new Date() } });
    await expect(
      decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
