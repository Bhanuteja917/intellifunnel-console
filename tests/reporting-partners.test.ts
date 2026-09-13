import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { getPartnerScorecardReport } from "@/lib/reporting/partners";
import { defaultDateRange } from "@/lib/reporting/shared";

async function setup() {
  const db = testDb();
  const client = await createOrganization(db, { isClient: true, isInternal: false });
  const partner = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const otherPartner = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const partnerUser = await createUser(db, partner.id, "PARTNER_ADMIN");
  const otherPartnerUser = await createUser(db, otherPartner.id, "PARTNER_ADMIN");
  const partnerActor = await loadActor(db, partnerUser.id);
  const otherPartnerActor = await loadActor(db, otherPartnerUser.id);

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
      pricingUnit: "CPL", requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: client.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live", deliveredCount: 2,
    },
  });
  await db.partnerAllocation.create({
    data: {
      campaignChannelId: channel.id, partnerOrganizationId: partner.id, allocatedQuantity: 5, deliveredCount: 2,
      payoutRateMinor: 500n, payoutCurrency: "USD", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });

  async function createLead(lifecycleStatus: "accepted" | "rejected", rejectReasonId?: string) {
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const email = `lead-${Date.now()}-${Math.random()}@example.com`;
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
    const submission = await db.leadSubmission.create({
      data: {
        campaignChannelId: channel.id, sourceType: "partner", submittedById: partnerUser.id,
        partnerOrganizationId: partner.id, mappingJson: {},
      },
    });
    return db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "partner", verificationStatus: lifecycleStatus === "accepted" ? "passed" : "failed",
        lifecycleStatus, rejectReasonId, fieldValuesJson: {},
      },
    });
  }

  return { db, partnerActor, otherPartnerActor, partner, channel, createLead };
}

describe("getPartnerScorecardReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("computes acceptance rate and per-channel breakdown for the partner's own leads", async () => {
    const { db, partnerActor, partner, channel, createLead } = await setup();
    const rejectReason = await db.rejectReason.create({
      data: { code: "DUP", label: "Duplicate", category: "duplicate", isPartnerReplaceable: true },
    });
    await createLead("accepted");
    await createLead("accepted");
    await createLead("rejected", rejectReason.id);

    const report = await getPartnerScorecardReport(db, partnerActor, {
      partnerOrganizationId: partner.id, dateRange: defaultDateRange(),
    });

    expect(report.acceptanceRate).toBeCloseTo(2 / 3);
    expect(report.rejectReasonBreakdown).toEqual([{ rejectReasonId: rejectReason.id, code: "DUP", label: "Duplicate", count: 1 }]);
    expect(report.channelBreakdown).toEqual([
      expect.objectContaining({
        campaignChannelId: channel.id, allocatedQuantity: 5, deliveredCount: 2,
        leadsSubmitted: 3, leadsAccepted: 2, leadsRejected: 1,
      }),
    ]);
  });

  it("excludes non-active allocations from the channel breakdown, like /partner/allocations does", async () => {
    const { db, partnerActor, partner, channel } = await setup();
    await db.partnerAllocation.create({
      data: {
        campaignChannelId: channel.id, partnerOrganizationId: partner.id, allocatedQuantity: 99, deliveredCount: 0,
        payoutRateMinor: 500n, payoutCurrency: "USD",
        // `ended` rather than `paused`/`draft` only because the partial unique
        // index PartnerAllocation_channel_partner_active_key forbids a second
        // non-ended allocation for the same partner+channel pair.
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "ended",
      },
    });

    const report = await getPartnerScorecardReport(db, partnerActor, {
      partnerOrganizationId: partner.id, dateRange: defaultDateRange(),
    });

    expect(report.channelBreakdown).toHaveLength(1);
    expect(report.channelBreakdown[0]?.allocatedQuantity).toBe(5);
  });

  it("denies a partner actor requesting another partner's scorecard", async () => {
    const { db, otherPartnerActor, partner } = await setup();
    await expect(
      getPartnerScorecardReport(db, otherPartnerActor, { partnerOrganizationId: partner.id, dateRange: defaultDateRange() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
