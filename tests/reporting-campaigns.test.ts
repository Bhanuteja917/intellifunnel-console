import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getCampaignPerformanceReport } from "@/lib/reporting/campaigns";
import { defaultDateRange } from "@/lib/reporting/shared";

async function setup() {
  const db = testDb();
  const client = await createOrganization(db, { isClient: true, isInternal: false });
  const otherClient = await createOrganization(db, { isClient: true, isInternal: false });
  const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
  const otherClientUser = await createUser(db, otherClient.id, "CLIENT_VIEWER");
  const clientActor = await loadActor(db, clientUser.id);
  const otherClientActor = await loadActor(db, otherClientUser.id);

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
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active", deliveredCount: 4,
    },
  });

  async function createLead(lifecycleStatus: "new" | "accepted" | "rejected", slaBreached: boolean) {
    const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
    const email = normalizeEmail(`lead-${Date.now()}-${Math.random()}@example.com`);
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
    const submission = await db.leadSubmission.create({
      data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: clientUser.id, mappingJson: {} },
    });
    return db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "internal", verificationStatus: "passed", lifecycleStatus, slaBreached, fieldValuesJson: {},
      },
    });
  }

  return { db, clientActor, otherClientActor, campaign, channel, createLead };
}

describe("getCampaignPerformanceReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("counts leads by lifecycle status and computes the SLA breach rate", async () => {
    const { db, clientActor, campaign, channel, createLead } = await setup();
    await createLead("accepted", false);
    await createLead("accepted", true);
    await createLead("rejected", false);

    const report = await getCampaignPerformanceReport(db, clientActor, {
      campaignId: campaign.id, dateRange: defaultDateRange(),
    });

    expect(report.leadsSubmitted).toBe(3);
    expect(report.leadsAccepted).toBe(2);
    expect(report.leadsRejected).toBe(1);
    expect(report.slaBreachRate).toBeCloseTo(1 / 3);
    expect(report.channels).toEqual([
      expect.objectContaining({ campaignChannelId: channel.id, contractedQuantity: 10, deliveredCount: 4 }),
    ]);
  });

  it("denies a client actor from another organisation", async () => {
    const { db, otherClientActor, campaign } = await setup();
    await expect(
      getCampaignPerformanceReport(db, otherClientActor, { campaignId: campaign.id, dateRange: defaultDateRange() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError for an unknown campaign", async () => {
    const { db, clientActor } = await setup();
    await expect(
      getCampaignPerformanceReport(db, clientActor, { campaignId: "missing", dateRange: defaultDateRange() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
