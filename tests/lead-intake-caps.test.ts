import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAllocation } from "@/lib/allocations/crud";
import { submitLeadFile } from "@/lib/leads/intake";
import { decideLeadVerification } from "@/lib/leads/verification";
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
      currency: "USD",
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
      advisoryIcpMatch: false, advisoryTalMatch: false,
    },
  });
  await db.leadFieldSpec.create({
    data: { campaignChannelId: campaignChannel.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });
  // Without a spec for it, companyDomain never survives validateFieldValues
  // (it only projects fields the campaign has a LeadFieldSpec for), so every
  // row would fail structurally ("neither a company name nor a company
  // domain") before ever reaching the business-rule pipeline this suite
  // exercises.
  await db.leadFieldSpec.create({
    data: { campaignChannelId: campaignChannel.id, fieldKey: "companyDomain", label: "Company Domain", dataType: "string", isRequired: false, rejectIfMissing: false },
  });
  return { db, actor, allocActor, campaignChannel, partnerOrg, campaign, clientOrg, internalOrg };
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
    await seedSettings(testDb());
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
    const { db, actor, campaignChannel, clientOrg } = await setupChannel(10);
    const normalizedEmail = normalizeEmail("a@example.com");
    const list = await db.suppressionList.create({
      data: { ownerOrganizationId: clientOrg.id, name: "Suppress", isReusable: false, type: "custom" },
    });
    await db.suppressionEntry.create({
      data: { listId: list.id, type: "email", value: normalizedEmail, valueHash: hashSuppressionValue(normalizedEmail) },
    });
    await db.channelSuppressionList.create({ data: { campaignChannelId: campaignChannel.id, listId: list.id } });

    await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
    expect(updated.deliveredCount).toBe(0);
    expect(updated.reservedCount).toBe(0);
  });

  it("releases the allocation claim when the allocation claim succeeds but the channel claim then fails", async () => {
    // contractedQuantity=1 (tight channel cap) but allocatedQuantity=5 (loose
    // allocation cap) — the only way to force the order that matters: the
    // allocation claim must succeed before the channel claim is even
    // attempted, so a channel-cap failure here forces intake.ts's
    // compensating releaseAllocationSlot call, not a code path where the
    // allocation was already the thing that failed.
    const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel(1);
    await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 5, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });

    // Fill the channel's one slot with an unrelated internal submission —
    // the allocation is untouched by this (internal rows never claim it),
    // so afterwards the channel is at cap while the allocation still has
    // four of its five slots free.
    const fill = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("filler@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const filledLead = await db.lead.findFirstOrThrow({ where: { submissionId: fill.submissionId } });
    expect(filledLead.verificationStatus).toBe("passed");

    const result = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
      content: csvRow("partner-row@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    expect(lead.verificationStatus).toBe("failed");
    const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
    // CHANNEL_CAP_REACHED, not ALLOCATION_CAP_EXCEEDED — the allocation claim
    // itself succeeded; it was the channel claim that failed afterwards.
    expect(reason.code).toBe("CHANNEL_CAP_REACHED");

    const finalAllocation = await db.partnerAllocation.findFirstOrThrow({
      where: { campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id },
    });
    // Proves the compensating releaseAllocationSlot call actually ran: had it
    // not, this row's successful allocation claim would have leaked a
    // permanently-claimed slot even though the row itself was rejected.
    expect(finalAllocation.reservedCount + finalAllocation.deliveredCount).toBe(0);
  });

  it("binds a lead to the live allocation, never to an ended predecessor", async () => {
    // The exact reallocation workflow createAllocation's own guard message
    // prescribes ("end it before creating a new one") leaves two rows for the
    // same partner+channel: one `ended`, one live. intake.ts used to resolve
    // the allocation with an unfiltered findFirst while verification.ts
    // filtered on `status: { not: "ended" }` — so the two halves of one
    // lead's lifecycle could bind to *different* rows, driving the live row's
    // reservedCount to -1, leaking a reservation on the ended row that
    // nothing releases, and testing the wrong (old, smaller) cap at intake.
    const { db, actor, allocActor, campaignChannel, partnerOrg, clientOrg, internalOrg } =
      await setupChannel(100);

    // Force the row to `needsReview` rather than auto-`passed`: an advisory
    // TAL with an attached (entry-less) list makes every account "unmatched".
    // `needsReview` is the only state decideLeadVerification can act on, and
    // it is also the state that leaves a *reservation* behind at intake —
    // exactly the counter this regression is about.
    await db.campaignChannel.update({ where: { id: campaignChannel.id }, data: { advisoryTalMatch: true } });
    const talList = await db.targetAccountList.create({
      data: { ownerOrganizationId: clientOrg.id, name: "TAL", isReusable: false },
    });
    await db.channelTargetAccountList.create({ data: { campaignChannelId: campaignChannel.id, listId: talList.id } });

    const reviewer = await createUser(db, internalOrg.id, "QUALITY");
    const reviewerActor = await loadActor(db, reviewer.id);

    // Allocation A: tiny cap, then ended. Had intake bound to it, the single
    // row below would have been rejected against A's cap of 1.
    const allocationA = await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 1, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });
    await db.partnerAllocation.update({ where: { id: allocationA.id }, data: { status: "ended" } });

    // Allocation B: the replacement, and now the only non-ended row.
    const allocationB = await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 50, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });

    const result = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
      content: csvRow("live-alloc@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    expect(lead.verificationStatus).toBe("needsReview");

    const bAfterIntake = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocationB.id } });
    expect(bAfterIntake.reservedCount).toBe(1);
    expect(bAfterIntake.deliveredCount).toBe(0);
    const aAfterIntake = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocationA.id } });
    expect(aAfterIntake.reservedCount).toBe(0);
    expect(aAfterIntake.deliveredCount).toBe(0);

    await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

    const bAfterAccept = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocationB.id } });
    expect(bAfterAccept.reservedCount).toBe(0);
    expect(bAfterAccept.deliveredCount).toBe(1);

    // The ended row must never have been touched by either half — under the
    // old behaviour this row held the reservation and B went to -1.
    const aAfterAccept = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocationA.id } });
    expect(aAfterAccept.reservedCount).toBe(0);
    expect(aAfterAccept.deliveredCount).toBe(0);
  });

  it("reports an ended-only allocation distinctly from no allocation at all", async () => {
    const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel(100);

    // No allocation whatsoever.
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("none@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      }),
    ).rejects.toThrow(/no allocation on the selected channel/);

    const allocation = await createAllocation(db, allocActor, {
      campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
      allocatedQuantity: 5, payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    });
    await db.partnerAllocation.update({ where: { id: allocation.id }, data: { status: "ended" } });

    // Ended-only: the generic message would send the operator looking for an
    // allocation that plainly exists in the admin UI.
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("ended@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      }),
    ).rejects.toThrow(/has ended/);
  });
});
