import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { getOpsDashboardReport } from "@/lib/reporting/ops";
import { defaultDateRange } from "@/lib/reporting/shared";

describe("getOpsDashboardReport", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("rolls up leads, SLA breaches, delivery failures and top reject reasons platform-wide", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const opsUser = await createUser(db, internal.id, "OPERATIONS");
    const opsActor = await loadActor(db, opsUser.id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: { code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id, pricingUnit: "CPL", requiresTeleVerification: false },
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
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    const rejectReason = await db.rejectReason.create({
      data: { code: "DUP", label: "Duplicate", category: "duplicate", isPartnerReplaceable: true },
    });

    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "a@x.com", emailNormalized: "a@x.com" } });
    const submission = await db.leadSubmission.create({
      data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: opsUser.id, mappingJson: {} },
    });
    await db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "internal", verificationStatus: "failed", lifecycleStatus: "rejected",
        rejectReasonId: rejectReason.id, slaBreached: true, fieldValuesJson: {},
      },
    });
    await db.deliveryRun.create({ data: { campaignChannelId: channel.id, method: "webhook", status: "failed" } });

    const report = await getOpsDashboardReport(db, opsActor, { dateRange: defaultDateRange() });

    expect(report.leadsByLifecycleStatus).toEqual({ rejected: 1 });
    expect(report.slaBreaches).toBe(1);
    expect(report.deliveryFailures).toBe(1);
    expect(report.topRejectReasons).toEqual([{ rejectReasonId: rejectReason.id, code: "DUP", label: "Duplicate", count: 1 }]);
  });

  it("denies a non-internal actor", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true, isInternal: false });
    const clientUser = await createUser(db, client.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, clientUser.id);

    await expect(getOpsDashboardReport(db, actor, { dateRange: defaultDateRange() })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
