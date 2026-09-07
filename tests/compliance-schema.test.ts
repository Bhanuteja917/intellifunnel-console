import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";

async function setupChannel() {
  const db = testDb();
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const manager = await loadActor(db, (await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER")).id);
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: { code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id, pricingUnit: "CPL" },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), currency: "USD",
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  return { db, manager, clientOrg, campaignChannel };
}

describe("E16 schema", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("creates a LeadConsent tied 1:1 to a Lead", async () => {
    const { db, manager, campaignChannel } = await setupChannel();
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({
      data: { accountId: account.id, email: "a@acme.com", emailNormalized: "a@acme.com" },
    });
    const submission = await db.leadSubmission.create({
      data: { campaignChannelId: campaignChannel.id, sourceType: "internal", submittedById: manager.userId, mappingJson: {} },
    });
    const lead = await db.lead.create({
      data: { campaignChannelId: campaignChannel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id, sourceType: "internal", fieldValuesJson: {} },
    });

    const consent = await db.leadConsent.create({
      data: { leadId: lead.id, acceptedAt: new Date("2026-09-07T10:00:00Z") },
    });

    expect(consent.leadId).toBe(lead.id);
    await expect(db.leadConsent.create({ data: { leadId: lead.id, acceptedAt: new Date() } })).rejects.toThrow();
  });

  it("allows a null personalDataRetentionMonths override on Organization", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    expect(org.personalDataRetentionMonths).toBeNull();
    const updated = await db.organization.update({ where: { id: org.id }, data: { personalDataRetentionMonths: 24 } });
    expect(updated.personalDataRetentionMonths).toBe(24);
  });
});
