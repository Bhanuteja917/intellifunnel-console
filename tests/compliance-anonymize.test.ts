import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings"; // seeds personalDataRetentionMonths: 12 (SETTING_DEFAULTS)
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { anonymizeExpiredContacts } from "@/lib/compliance/retention";

async function makeAcceptedLead(db: ReturnType<typeof testDb>, opts: {
  clientOrgId: string; contactId: string; accountId: string; acceptedAt: Date;
  /** LeadFieldSpec.fieldKey rows to create for this lead's campaign, in whatever casing the "campaign admin" chose. */
  fieldSpecKeys?: string[];
  fieldValues?: Record<string, string>;
}) {
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: { code: `CT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "CT", funnelStageId: stage.id, pricingUnit: "CPL" },
  });
  const ctv = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: opts.clientOrgId, name: "C", code: `RET-${Math.random().toString(36).slice(2, 8)}`,
      status: "live", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: ctv.id, contractedQuantity: 10,
      clientUnitPriceMinor: 1000n, currency: "USD", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), status: "active",
    },
  });
  for (const fieldKey of opts.fieldSpecKeys ?? []) {
    await db.leadFieldSpec.create({
      data: { campaignId: campaign.id, fieldKey, label: fieldKey, dataType: "string" },
    });
  }
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: manager.userId, mappingJson: {} },
  });
  return db.lead.create({
    data: {
      campaignChannelId: channel.id, submissionId: submission.id, contactId: opts.contactId, accountId: opts.accountId,
      sourceType: "internal", fieldValuesJson: opts.fieldValues ?? {}, lifecycleStatus: "accepted", acceptedAt: opts.acceptedAt,
    },
  });
}

describe("anonymizeExpiredContacts", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb()); // personalDataRetentionMonths defaults to 12 — see SETTING_DEFAULTS
  });

  it("scrubs a contact whose only lead's retention window has passed", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "old@acme.com", emailNormalized: "old@acme.com", firstName: "Old" } });
    await makeAcceptedLead(db, { clientOrgId: client.id, contactId: contact.id, accountId: account.id, acceptedAt: new Date("2024-01-01") });

    const count = await anonymizeExpiredContacts(db, new Date("2026-09-07")); // > 12 months (platform default) past 2024-01-01
    expect(count).toBe(1);

    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstName).toBeNull();
    expect(after.email).not.toBe("old@acme.com");
    expect(after.anonymisedAt).not.toBeNull();

    // The batch job is automated, so the audit row is actor-less — but it must
    // exist (plan Global Constraint: no unaudited PII mutation).
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Contact", entityId: contact.id, action: "anonymize" },
    });
    expect(audit.actorUserId).toBeNull();
    expect(audit.actorOrganizationId).toBeNull();
  });

  it("scrubs every PII column on the contact, not just the ones spot-checked elsewhere", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Full", normalizedName: "full" } });
    const contact = await db.contact.create({
      data: {
        accountId: account.id, email: "full@full.com", emailNormalized: "full@full.com",
        firstName: "Full", lastName: "Name", phone: "+919876543210", jobTitle: "VP",
        seniority: "vp", jobFunction: "sales", country: "IN", linkedinUrl: "https://linkedin.com/in/full",
      },
    });
    await makeAcceptedLead(db, { clientOrgId: client.id, contactId: contact.id, accountId: account.id, acceptedAt: new Date("2024-01-01") });

    expect(await anonymizeExpiredContacts(db, new Date("2026-09-07"))).toBe(1);

    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    // Every field buildContactPiiPatch claims to scrub — a field-name typo in
    // the patch would silently leave the real value behind without this.
    expect(after.firstName).toBeNull();
    expect(after.lastName).toBeNull();
    expect(after.phone).toBeNull();
    expect(after.jobTitle).toBeNull();
    expect(after.seniority).toBeNull();
    expect(after.jobFunction).toBeNull();
    expect(after.country).toBeNull();
    expect(after.linkedinUrl).toBeNull();
    expect(after.email).toBe(`anonymized-${contact.id}@erased.invalid`);
    expect(after.emailNormalized).toBe(`anonymized-${contact.id}@erased.invalid`);
    expect(after.anonymisedAt).not.toBeNull();
  });

  it("redacts the PII keys inside the lead's own fieldValuesJson, matching field specs case-insensitively", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Blob", normalizedName: "blob" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "blob@blob.com", emailNormalized: "blob@blob.com", firstName: "Blob" } });
    // Deliberately non-canonical casing on the specs — campaigns name their
    // own CSV columns, so the redaction must match case-insensitively.
    const lead = await makeAcceptedLead(db, {
      clientOrgId: client.id, contactId: contact.id, accountId: account.id, acceptedAt: new Date("2024-01-01"),
      fieldSpecKeys: ["Email", "FirstName", "companyName"],
      fieldValues: { Email: "blob@blob.com", FirstName: "Blob", companyName: "Blob Industries" },
    });

    expect(await anonymizeExpiredContacts(db, new Date("2026-09-07"))).toBe(1);

    const afterLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(afterLead.fieldValuesJson).toEqual({
      Email: null,
      FirstName: null,
      companyName: "Blob Industries", // not a PII field — the blob is not blanket-wiped
    });
  });

  it("respects a per-client retention override", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    await db.organization.update({ where: { id: client.id }, data: { personalDataRetentionMonths: 36 } });
    const account = await db.account.create({ data: { name: "Beta", normalizedName: "beta" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "b@beta.com", emailNormalized: "b@beta.com" } });
    await makeAcceptedLead(db, { clientOrgId: client.id, contactId: contact.id, accountId: account.id, acceptedAt: new Date("2024-01-01") });

    // 12 months (platform default) would have expired by 2026-09-07, but this client's 36-month override hasn't.
    const count = await anonymizeExpiredContacts(db, new Date("2026-09-07"));
    expect(count).toBe(0);
    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.anonymisedAt).toBeNull();
  });

  it("never anonymizes a contact with a still-open (never-accepted) lead", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Gamma", normalizedName: "gamma" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "g@gamma.com", emailNormalized: "g@gamma.com" } });
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: { code: `CT2-${Date.now()}`, name: "CT2", funnelStageId: stage.id, pricingUnit: "CPL" },
    });
    const ctv = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: client.id, name: "C2", code: `RET2-${Math.random().toString(36).slice(2, 8)}`,
        status: "live", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), currency: "USD",
      },
    });
    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: ctv.id, contractedQuantity: 10,
        clientUnitPriceMinor: 1000n, currency: "USD", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), status: "active",
      },
    });
    const submission = await db.leadSubmission.create({ data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: manager.userId, mappingJson: {} } });
    // lifecycleStatus stays "new", acceptedAt stays null (default) — deliberately not using makeAcceptedLead.
    await db.lead.create({ data: { campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id, sourceType: "internal", fieldValuesJson: {} } });

    const count = await anonymizeExpiredContacts(db, new Date("2030-01-01"));
    expect(count).toBe(0);
  });

  it("is idempotent — a second run finds nothing left to anonymize", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Delta", normalizedName: "delta" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "d@delta.com", emailNormalized: "d@delta.com" } });
    await makeAcceptedLead(db, { clientOrgId: client.id, contactId: contact.id, accountId: account.id, acceptedAt: new Date("2024-01-01") });

    expect(await anonymizeExpiredContacts(db, new Date("2026-09-07"))).toBe(1);
    expect(await anonymizeExpiredContacts(db, new Date("2026-09-07"))).toBe(0);
  });
});
