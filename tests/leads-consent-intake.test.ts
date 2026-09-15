import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { submitLeadFile } from "@/lib/leads/intake";

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
      contractedQuantity: 100, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });
  await db.leadFieldSpec.create({
    data: { campaignChannelId: campaignChannel.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });
  await db.leadFieldSpec.create({
    data: { campaignChannelId: campaignChannel.id, fieldKey: "companyDomain", label: "Company Domain", dataType: "string", isRequired: false, rejectIfMissing: false },
  });
  return { db, manager, clientOrg, campaignChannel };
}

describe("consent capture at intake", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedRejectReasons(testDb());
    await seedSettings(testDb());
  });

  it("creates a LeadConsent with supplied timestamp/ip/sourceUrl and resolves consentTextVersionId via formSlug", async () => {
    const { db, manager, clientOrg, campaignChannel } = await setupChannel();
    const consentText = await db.consentTextVersion.create({
      data: { name: "Standard", body: "I agree...", version: 1, language: "en", effectiveFrom: new Date("2026-01-01") },
    });
    const asset = await db.asset.create({ data: { ownerOrganizationId: clientOrg.id, name: "WP", type: "whitepaper", language: "en" } });
    const version = await db.assetVersion.create({ data: { assetId: asset.id, version: 1, storageKey: "k", fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1 } });
    await db.assetPlacement.create({
      data: {
        campaignChannelId: campaignChannel.id, assetId: asset.id, assetVersionId: version.id,
        landingPageUrl: "https://x", formSlug: "wp-form-1", consentTextVersionId: consentText.id,
      },
    });

    const csv = [
      "email,companyDomain,ts,ip,src,slug",
      "a@corp.com,corp.com,2026-09-01T12:00:00Z,1.2.3.4,https://landing,wp-form-1",
    ].join("\n");
    const result = await submitLeadFile(db, manager, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csv, mapping: { email: "email", companyDomain: "companyDomain" },
      consentMapping: { timestamp: "ts", ip: "ip", sourceUrl: "src", formSlug: "slug" },
    });

    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    const consent = await db.leadConsent.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(consent.consentTextVersionId).toBe(consentText.id);
    expect(consent.acceptedAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(consent.ipAddress).toBe("1.2.3.4");
    expect(consent.sourceUrl).toBe("https://landing");
  });

  it("falls back to submittedAt and nulls when no consentMapping is supplied", async () => {
    const { db, manager, campaignChannel } = await setupChannel();
    const before = new Date();
    const result = await submitLeadFile(db, manager, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: "email,companyDomain\nb@corp.com,corpb.com\n", mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    const consent = await db.leadConsent.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(consent.consentTextVersionId).toBeNull();
    expect(consent.ipAddress).toBeNull();
    expect(consent.sourceUrl).toBeNull();
    expect(consent.acceptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("does not fail the row when formSlug doesn't match any placement", async () => {
    const { db, manager, campaignChannel } = await setupChannel();
    const csv = "email,companyDomain,slug\nc@corp.com,corpc.com,unknown-slug\n";
    const result = await submitLeadFile(db, manager, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csv, mapping: { email: "email", companyDomain: "companyDomain" },
      consentMapping: { formSlug: "slug" },
    });
    expect(result.rowsFailed).toBe(0);
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    const consent = await db.leadConsent.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(consent.consentTextVersionId).toBeNull();
  });
});
