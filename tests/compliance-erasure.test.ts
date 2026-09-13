import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { eraseContactNow } from "@/lib/compliance/retention";

describe("eraseContactNow", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("scrubs a contact immediately regardless of any lead's acceptance date, and writes an audit entry", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "e@acme.com", emailNormalized: "e@acme.com", firstName: "Erin" } });

    await eraseContactNow(db, ops, contact.id);

    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstName).toBeNull();
    expect(after.anonymisedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Contact", entityId: contact.id, action: "anonymize" } });
    expect(audit.actorUserId).toBe(ops.userId);
  });

  it("also redacts the PII keys inside every one of the contact's lead fieldValuesJson blobs", async () => {
    const db = testDb();
    await seedFunnelStages(db);
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "j@acme.com", emailNormalized: "j@acme.com", firstName: "Jo" } });

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: { code: `CT-ER-${Math.random().toString(36).slice(2, 8)}`, name: "CT", funnelStageId: stage.id, pricingUnit: "CPL" },
    });
    const ctv = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: client.id, name: "C", code: `ER-${Math.random().toString(36).slice(2, 8)}`,
        status: "live", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), currency: "USD",
      },
    });
    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: ctv.id, contractedQuantity: 10,
        clientUnitPriceMinor: 1000n, currency: "USD", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), status: "live",
      },
    });
    for (const fieldKey of ["email", "firstName", "companyName"]) {
      await db.leadFieldSpec.create({ data: { campaignChannelId: channel.id, fieldKey, label: fieldKey, dataType: "string" } });
    }
    const submission = await db.leadSubmission.create({
      data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: ops.userId, mappingJson: {} },
    });
    const lead = await db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "internal",
        fieldValuesJson: { email: "j@acme.com", firstName: "Jo", companyName: "Acme" },
      },
    });

    await eraseContactNow(db, ops, contact.id);

    const afterLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(afterLead.fieldValuesJson).toEqual({ email: null, firstName: null, companyName: "Acme" });
  });

  it("keeps the erased PII out of its own audit entry", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "secret@acme.com", emailNormalized: "secret@acme.com", firstName: "Secret" } });

    await eraseContactNow(db, ops, contact.id);

    // AuditLog is append-only in this codebase — a `before` snapshot holding
    // the real name/email would outlive the erasure it records.
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Contact", entityId: contact.id, action: "anonymize" } });
    expect(audit.beforeJson).toBeNull();
    expect(JSON.stringify(audit.afterJson)).not.toContain("secret@acme.com");
    expect(JSON.stringify(audit.afterJson)).not.toContain("Secret");
  });

  it("rejects an actor without compliance:write", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "f@acme.com", emailNormalized: "f@acme.com" } });

    await expect(eraseContactNow(db, manager, contact.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for an unknown contact id", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    await expect(eraseContactNow(db, ops, "nonexistent")).rejects.toThrow(NotFoundError);
  });
});
