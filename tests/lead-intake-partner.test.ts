import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { submitLeadFile } from "@/lib/leads/intake";

async function setupChannel() {
  const db = testDb();
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  // CAMPAIGN_MANAGER (not OPERATIONS) — submitLeadFile requires "campaign:write",
  // which only CAMPAIGN_MANAGER has (see src/lib/auth/permissions.ts MATRIX).
  const opsUser = await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER");
  const actor = await loadActor(db, opsUser.id);

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
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });

  return { db, actor, campaignChannel, partnerOrg };
}

describe("submitLeadFile — partner attribution", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    // submitLeadFile now looks up the two cap-reached RejectReason rows
    // unconditionally per submission (this task), so every caller needs them
    // seeded — production always has them via the full seed script; this
    // test's beforeEach didn't need them before this task.
    await seedRejectReasons(testDb());
  });

  it("rejects a partnerOrganizationId with no allocation on this channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id,
        sourceType: "partner",
        partnerOrganizationId: partnerOrg.id,
        content: "email\njane@example.com",
        mapping: { email: "email" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects sourceType partner with no partnerOrganizationId", async () => {
    const { db, actor, campaignChannel } = await setupChannel();
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id,
        sourceType: "partner",
        content: "email\njane@example.com",
        mapping: { email: "email" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("stores partnerOrganizationId when the partner is allocated to this channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    await db.partnerAllocation.create({
      data: {
        campaignChannelId: campaignChannel.id,
        partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 10,
        payoutRateMinor: 100n,
        payoutCurrency: "USD",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    });

    const result = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id,
      sourceType: "partner",
      partnerOrganizationId: partnerOrg.id,
      content: "email\njane@example.com",
      mapping: { email: "email" },
    });

    const submission = await db.leadSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(submission.partnerOrganizationId).toBe(partnerOrg.id);
  });
});
