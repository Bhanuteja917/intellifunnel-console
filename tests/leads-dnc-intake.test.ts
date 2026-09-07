import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { hashSuppressionValue } from "@/lib/lists/suppression";
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
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "companyDomain", label: "Company Domain", dataType: "string", isRequired: false, rejectIfMissing: false },
  });
  return { db, manager, clientOrg, campaignChannel };
}

function csvRow(email: string, domain: string): string {
  return `email,companyDomain\n${email},${domain}\n`;
}

describe("DNC enforcement at intake", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedRejectReasons(testDb());
    await seedSettings(testDb());
  });

  it("rejects a row whose email is on the client's DNC list, with reason DO_NOT_CONTACT", async () => {
    const { db, manager, clientOrg, campaignChannel } = await setupChannel();
    await db.doNotContact.create({
      data: {
        type: "email", value: "blocked@corp.com", valueHash: hashSuppressionValue("blocked@corp.com"),
        clientOrganizationId: clientOrg.id,
      },
    });

    const result = await submitLeadFile(db, manager, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("blocked@corp.com", "corp.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });

    expect(result.rowsAccepted).toBe(1); // still "accepted" at the file-structural level — see Global Constraints
    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    expect(lead.verificationStatus).toBe("failed");
    const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
    expect(reason.code).toBe("DO_NOT_CONTACT");
    expect(lead.lifecycleStatus).toBe("new"); // never auto-accepted
  });

  it("does not affect a row whose email is clean", async () => {
    const { db, manager, campaignChannel } = await setupChannel();

    const result = await submitLeadFile(db, manager, {
      campaignChannelId: campaignChannel.id, sourceType: "internal",
      content: csvRow("clean@corp.com", "cleancorp.com"), mapping: { email: "email", companyDomain: "companyDomain" },
    });

    const lead = await db.lead.findFirstOrThrow({ where: { submissionId: result.submissionId } });
    expect(lead.verificationStatus).not.toBe("failed");
  });
});
