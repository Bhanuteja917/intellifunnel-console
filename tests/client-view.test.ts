import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { getLeadsForClient } from "@/lib/leads/client-view";
import { ForbiddenError } from "@/lib/errors";

async function seedClientOrgWithChannel() {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const otherClientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const clientUser = await createUser(db, clientOrg.id, "CLIENT_ADMIN");

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
      producesLeads: true, requiresAsset: false, metricMode: "event",
      allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: { name: "Test Channel" }, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
      currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
    },
  });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: channel.id, sourceType: "internal", submittedById: clientUser.id, mappingJson: {} },
  });

  async function makeLead(opts: { clientVisible: boolean; verificationStatus?: "needsReview" | "passed" | "failed" }) {
    const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
    const email = normalizeEmail(`lead-${Math.random()}@example.com`);
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email, firstName: "Jane" } });
    return db.lead.create({
      data: {
        campaignChannelId: channel.id, submissionId: submission.id, contactId: contact.id, accountId: account.id,
        sourceType: "internal", fieldValuesJson: { companySize: "51-200" },
        clientVisible: opts.clientVisible,
        verificationStatus: opts.verificationStatus ?? "pending",
        acceptedAt: opts.clientVisible ? new Date("2026-01-05T00:00:00.000Z") : null,
      },
    });
  }

  return { db, clientOrg, otherClientOrg, clientActor: await loadActor(db, clientUser.id), channel, makeLead };
}

describe("getLeadsForClient", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("returns only clientVisible leads for the actor's own organisation", async () => {
    const { db, clientActor, makeLead } = await seedClientOrgWithChannel();
    const visible = await makeLead({ clientVisible: true });
    await makeLead({ clientVisible: false, verificationStatus: "needsReview" });
    await makeLead({ clientVisible: false, verificationStatus: "failed" });

    const { leads } = await getLeadsForClient(db, clientActor, {});
    expect(leads).toHaveLength(1);
    expect(leads[0]!.id).toBe(visible.id);
    expect(leads[0]!.accountName).toBe("Acme");
    expect(leads[0]!.fieldValues).toEqual({ companySize: "51-200" });
  });

  it("reports deliveryStatus pending when an active DeliveryConfig exists but no DeliveryRun yet, and the run's status once one does", async () => {
    const { db, clientActor, makeLead, channel } = await seedClientOrgWithChannel();
    // Without an active DeliveryConfig on the channel, "no run yet" would (correctly, per the fix
    // below) report notConfigured instead of pending — so this test needs one to keep testing the
    // "pending" derivation specifically.
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: channel.id, method: "webhook",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    const noRunYet = await makeLead({ clientVisible: true });
    const delivered = await makeLead({ clientVisible: true });
    await db.deliveryRun.create({
      data: { campaignChannelId: channel.id, method: "webhook", status: "success", leads: { create: { leadId: delivered.id } } },
    });

    const { leads } = await getLeadsForClient(db, clientActor, {});
    const byId = new Map(leads.map((l) => [l.id, l]));
    expect(byId.get(noRunYet.id)!.deliveryStatus).toBe("pending");
    expect(byId.get(delivered.id)!.deliveryStatus).toBe("success");
  });

  it("reports deliveryStatus notConfigured for a lead on a channel with no DeliveryConfig at all, distinct from pending on a channel with an active config", async () => {
    const { db, clientActor, makeLead, channel } = await seedClientOrgWithChannel();
    // This channel has no DeliveryConfig — no run will ever be created for this lead, so "pending"
    // would be misleading forever.
    const unconfiguredLead = await makeLead({ clientVisible: true });

    const { leads } = await getLeadsForClient(db, clientActor, {});
    const byId = new Map(leads.map((l) => [l.id, l]));
    expect(byId.get(unconfiguredLead.id)!.deliveryStatus).toBe("notConfigured");

    // Confirm the distinction: adding an active config to the SAME channel flips a subsequent
    // no-run lead to pending instead.
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: channel.id, method: "webhook",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    const configuredLead = await makeLead({ clientVisible: true });
    const { leads: leadsAfter } = await getLeadsForClient(db, clientActor, {});
    const byIdAfter = new Map(leadsAfter.map((l) => [l.id, l]));
    expect(byIdAfter.get(configuredLead.id)!.deliveryStatus).toBe("pending");
    // The pre-existing lead is unaffected by the run itself, but its channel's config is now active,
    // so it too should read as pending (no run yet).
    expect(byIdAfter.get(unconfiguredLead.id)!.deliveryStatus).toBe("pending");
  });

  it("reports deliveryStatus notConfigured when the channel's DeliveryConfig exists but is paused", async () => {
    const { db, clientActor, makeLead, channel } = await seedClientOrgWithChannel();
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: channel.id, method: "webhook", status: "paused",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMappingJson: [{ source: "contact.email", target: "Email" }],
      },
    });
    const lead = await makeLead({ clientVisible: true });

    const { leads } = await getLeadsForClient(db, clientActor, {});
    const byId = new Map(leads.map((l) => [l.id, l]));
    expect(byId.get(lead.id)!.deliveryStatus).toBe("notConfigured");
  });

  it("never returns another organisation's clientVisible leads", async () => {
    const { db, clientActor, makeLead } = await seedClientOrgWithChannel();
    const ownLead = await makeLead({ clientVisible: true });

    // A second, unrelated client org with its own campaign/channel/lead, also clientVisible.
    const otherClientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const otherChannelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}-other`, name: "Other Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const otherChannelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: otherChannelType.id, version: 1, definitionJson: { name: "Other Channel" }, publishedById: "system" },
    });
    const otherCampaign = await db.campaign.create({
      data: {
        clientOrganizationId: otherClientOrg.id, name: "Other Campaign", code: `CAM-${Date.now()}-other`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const otherChannel = await db.campaignChannel.create({
      data: {
        campaignId: otherCampaign.id, channelTypeVersionId: otherChannelTypeVersion.id,
        contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    const otherUser = await db.user.create({
      data: { email: normalizeEmail(`other-${Date.now()}@example.com`), name: "Other", organizationId: otherClientOrg.id, status: "active" },
    });
    const otherSubmission = await db.leadSubmission.create({
      data: { campaignChannelId: otherChannel.id, sourceType: "internal", submittedById: otherUser.id, mappingJson: {} },
    });
    const otherAccount = await db.account.create({ data: { name: "OtherCo", normalizedName: normalizeCompanyName("OtherCo") } });
    const otherEmail = normalizeEmail(`other-lead-${Date.now()}@example.com`);
    const otherContact = await db.contact.create({ data: { accountId: otherAccount.id, email: otherEmail, emailNormalized: otherEmail } });
    await db.lead.create({
      data: {
        campaignChannelId: otherChannel.id, submissionId: otherSubmission.id, contactId: otherContact.id, accountId: otherAccount.id,
        sourceType: "internal", fieldValuesJson: {}, clientVisible: true, acceptedAt: new Date(),
      },
    });

    const { leads } = await getLeadsForClient(db, clientActor, {});
    expect(leads).toHaveLength(1);
    expect(leads[0]!.id).toBe(ownLead.id);
    expect(leads.some((l) => l.accountName === "OtherCo")).toBe(false);
  });

  it("denies an actor with no roles at all via assertPermission", async () => {
    const { db, clientActor } = await seedClientOrgWithChannel();
    // Every role in the matrix happens to include campaign:read today, so the
    // real isolation boundary here is organisation scoping (previous test) —
    // this just confirms the permission gate itself is present and wired up.
    await expect(getLeadsForClient(db, { ...clientActor, roles: [] }, {})).rejects.toThrow(ForbiddenError);
  });

  it("never returns another organisation's clientVisible leads for an internal actor either", async () => {
    // Regression test: org scoping in getLeadsForClient must be unconditional
    // (clientOrganizationId: actor.organizationId, no isInternal bypass) — see
    // partner-view.ts's documented convention and assertOrganizationAccess's
    // doc comment naming AUTH-10 read models as the layer responsible for
    // constraining what an internal actor sees. Using the shared
    // campaignChannelOrgScopeClause helper here (which resolves to `{}` for an
    // isInternal actor) would silently return every client organisation's
    // clientVisible leads to internal staff — this test proves that gap is
    // closed, not just that a CLIENT_ADMIN actor stays within their own org.
    const { db, makeLead } = await seedClientOrgWithChannel();
    await makeLead({ clientVisible: true });

    const internalOrg = await createOrganization(db, { isClient: false, isInternal: true });
    const internalUser = await createUser(db, internalOrg.id, "OPERATIONS");
    const internalActor = await loadActor(db, internalUser.id);

    const { leads } = await getLeadsForClient(db, internalActor, {});
    expect(leads).toHaveLength(0);
  });
});
