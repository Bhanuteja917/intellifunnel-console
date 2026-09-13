import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { getLeadBreakdownReport } from "@/lib/reporting/leads";
import { defaultDateRange } from "@/lib/reporting/shared";

async function setupChannel(db: ReturnType<typeof testDb>, clientOrgId: string) {
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}-${Math.random()}`, name: "Test Channel", funnelStageId: stage.id,
      pricingUnit: "CPL", requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrgId, name: "Test Campaign", code: `CAM-${Date.now()}-${Math.random()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), currency: "USD",
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

async function createLead(
  db: ReturnType<typeof testDb>,
  channelId: string,
  overrides: { verificationStatus: "passed" | "failed"; lifecycleStatus: "accepted" | "rejected"; rejectReasonId?: string },
) {
  const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
  const email = normalizeEmail(`lead-${Date.now()}-${Math.random()}@example.com`);
  const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: channelId, sourceType: "internal", submittedById: "system", mappingJson: {} },
  });
  return db.lead.create({
    data: {
      campaignChannelId: channelId, submissionId: submission.id, contactId: contact.id, accountId: account.id,
      sourceType: "internal", fieldValuesJson: {}, ...overrides,
    },
  });
}

describe("getLeadBreakdownReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("groups leads by verification status, lifecycle status and reject reason", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    const channel = await setupChannel(db, client.id);
    const rejectReason = await db.rejectReason.create({
      data: { code: "STALE", label: "Stale data", category: "dataQuality", isPartnerReplaceable: false },
    });

    await createLead(db, channel.id, { verificationStatus: "passed", lifecycleStatus: "accepted" });
    await createLead(db, channel.id, { verificationStatus: "failed", lifecycleStatus: "rejected", rejectReasonId: rejectReason.id });

    const report = await getLeadBreakdownReport(db, actor, { dateRange: defaultDateRange() });

    expect(report.byVerificationStatus).toEqual({ passed: 1, failed: 1 });
    expect(report.byLifecycleStatus).toEqual({ accepted: 1, rejected: 1 });
    expect(report.byRejectReason).toEqual([
      { rejectReasonId: rejectReason.id, code: "STALE", label: "Stale data", count: 1 },
    ]);
  });

  it("excludes leads from another organisation's campaign for a client actor", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const otherClient = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);
    const ownChannel = await setupChannel(db, client.id);
    const otherChannel = await setupChannel(db, otherClient.id);

    await createLead(db, ownChannel.id, { verificationStatus: "passed", lifecycleStatus: "accepted" });
    await createLead(db, otherChannel.id, { verificationStatus: "passed", lifecycleStatus: "accepted" });

    const report = await getLeadBreakdownReport(db, actor, { dateRange: defaultDateRange() });
    expect(report.byLifecycleStatus.accepted).toBe(1);
  });
});
