import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAllocation } from "@/lib/allocations/crud";
import { submitLeadFile } from "@/lib/leads/intake";
import { normalizeEmail } from "@/lib/normalise/email";
import { hashSuppressionValue } from "@/lib/lists/suppression";

async function setupChannel(contractedQuantity = 100) {
  const db = testDb();
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const opsUser = await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER");
  const actor = await loadActor(db, opsUser.id);
  const allocActor = await loadActor(db, (await createUser(db, internalOrg.id, "OPERATIONS")).id);

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
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });
  // Without a spec for it, companyDomain never survives validateFieldValues
  // (it only projects fields the campaign has a LeadFieldSpec for), so every
  // row would fail structurally ("neither a company name nor a company
  // domain") before ever reaching the business-rule pipeline this suite
  // exercises.
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "companyDomain", label: "Company Domain", dataType: "string", isRequired: false, rejectIfMissing: false },
  });
  return { db, actor, allocActor, campaignChannel, partnerOrg, campaign, clientOrg };
}

function csvRow(email: string) {
  // The domain must be a distinct, validly-parseable registrable domain per
  // email. Embedding the raw email (with its "@") into the domain column, as
  // in `example-${email}.com`, defeats tldts's registrable-domain extraction
  // — every such string normalizes down to the same "com.com", so two
  // concurrent rows would race on `Account.primaryDomain`'s unique
  // constraint before ever reaching the capacity claim this suite tests.
  const localPart = email.split("@")[0]!.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `email,companyDomain\n${email},${localPart}.com\n`;
}

describe("submitLeadFile — cap enforcement", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedRejectReasons(testDb());
  });

  it("rejects a row with ALLOCATION_CAP_EXCEEDED once the allocation is full", async () => {
    const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel();
    await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 1, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });

    const first = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
      content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    expect(first.rowsAccepted).toBe(1); // structurally accepted — the Lead was created, whatever its outcome

    const second = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
      content: csvRow("b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: second.submissionId } });
    expect(lead.verificationStatus).toBe("failed");
    const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
    expect(reason.code).toBe("ALLOCATION_CAP_EXCEEDED");
  });

  it("under true concurrency, exactly one of two simultaneous submissions claims the last slot", async () => {
    const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel();
    await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 1, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });

    // Two genuinely concurrent submissions (Promise.all, not sequential
    // awaits) racing for the same single slot. Postgres's row lock on the
    // conditional UPDATE inside claimAllocationSlot (Task 3) serializes
    // them — the second transaction blocks until the first commits, then
    // re-evaluates its WHERE predicate against the now-updated row — so
    // exactly one must win regardless of scheduling.
    const [resultA, resultB] = await Promise.all([
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("race-a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      }),
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("race-b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      }),
    ]);

    const leadA = await db.lead.findFirstOrThrow({ where: { submissionId: resultA.submissionId } });
    const leadB = await db.lead.findFirstOrThrow({ where: { submissionId: resultB.submissionId } });
    const outcomes = [leadA.verificationStatus, leadB.verificationStatus];
    expect(outcomes.filter((s) => s !== "failed")).toHaveLength(1);
    expect(outcomes.filter((s) => s === "failed")).toHaveLength(1);

    const finalAllocation = await db.partnerAllocation.findFirstOrThrow({
      where: { campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id },
    });
    expect(finalAllocation.reservedCount + finalAllocation.deliveredCount).toBe(1); // never over-claimed
  });

  it("rejects a row with CHANNEL_CAP_REACHED once the channel cap is full, even for an internal submission", async () => {
    const { db, actor, campaignChannel } = await setupChannel(1);
    const first = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    expect(first.rowsAccepted).toBe(1);

    const second = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: second.submissionId } });
    expect(lead.verificationStatus).toBe("failed");
    const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
    expect(reason.code).toBe("CHANNEL_CAP_REACHED");
  });

  it("claims deliveredCount (not reservedCount) for an auto-passed row", async () => {
    const { db, actor, campaignChannel } = await setupChannel(10);
    await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updated.deliveredCount).toBe(1);
    expect(updated.reservedCount).toBe(0);
  });

  it("does not consume any capacity for a row that fails for an unrelated reason (e.g. suppression)", async () => {
    const { db, actor, campaignChannel, campaign, clientOrg } = await setupChannel(10);
    const normalizedEmail = normalizeEmail("a@example.com");
    const list = await db.suppressionList.create({
      data: { ownerOrganizationId: clientOrg.id, name: "Suppress", isReusable: false, type: "custom" },
    });
    await db.suppressionEntry.create({
      data: { listId: list.id, type: "email", value: normalizedEmail, valueHash: hashSuppressionValue(normalizedEmail) },
    });
    await db.campaignSuppressionList.create({ data: { campaignId: campaign.id, listId: list.id } });

    await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updated.deliveredCount).toBe(0);
    expect(updated.reservedCount).toBe(0);
  });
});
