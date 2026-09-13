import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import {
  addCampaignChannel,
  createCampaign,
  getCampaignForActor,
  setIcpCriteria,
  setLeadFieldSpec,
} from "@/lib/campaigns/crud";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function setupCampaign() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true, defaultBillingCurrency: "USD" });
  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);
  return { db, admin, manager, client, version };
}

describe("campaign configuration", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("creates a campaign in draft with a unique code", async () => {
    const { db, manager, client } = await setupCampaign();

    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id,
      name: "Q4 Security Whitepaper",
      code: "ACME-Q4-SEC",
      startDate: new Date("2026-10-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
    });

    expect(campaign.status).toBe("draft");
    expect(campaign.code).toBe("ACME-Q4-SEC");
  });

  it("records the initial status history entry", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "C-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    const history = await db.campaignStatusHistory.findMany({ where: { campaignId: campaign.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe("draft");
    expect(history[0]?.fromStatus).toBeNull();
  });

  it("rejects a duplicate campaign code (NFR-D-2)", async () => {
    const { db, manager, client } = await setupCampaign();
    const input = {
      clientOrganizationId: client.id, name: "C", code: "DUP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    };
    await createCampaign(db, manager, input);

    await expect(createCampaign(db, manager, { ...input, name: "C2" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an end date before the start date", async () => {
    const { db, manager, client } = await setupCampaign();

    await expect(
      createCampaign(db, manager, {
        clientOrganizationId: client.id, name: "C", code: "BAD-DATES",
        startDate: new Date("2026-12-31"), endDate: new Date("2026-10-01"), currency: "USD",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a campaign against an organisation that is not a client", async () => {
    const { db, manager } = await setupCampaign();
    const partnerOnly = await createOrganization(db, { isClient: false, isPartner: true });

    await expect(
      createCampaign(db, manager, {
        clientOrganizationId: partnerOnly.id, name: "C", code: "NOT-CLIENT",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a currency the platform has no exponent for (CUR-6)", async () => {
    const { db, manager, client } = await setupCampaign();

    await expect(
      createCampaign(db, manager, {
        clientOrganizationId: client.id, name: "C", code: "BAD-CCY",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "XYZ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.campaign.findUnique({ where: { code: "BAD-CCY" } })).toBeNull();
  });

  it("rejects a channel whose currency differs from its campaign's", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "MIXED-CCY",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await expect(
      addCampaignChannel(db, manager, campaign.id, {
        channelTypeVersionId: version.id, contractedQuantity: 100,
        clientUnitPrice: "42.50", currency: "EUR",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.campaignChannel.count({ where: { campaignId: campaign.id } })).toBe(0);
  });

  it("replaces ICP criteria wholesale (channel-scoped)", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "ICP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const channel = await addCampaignChannel(db, manager, campaign.id, {
      channelTypeVersionId: version.id, contractedQuantity: 100,
      clientUnitPrice: "10.00", currency: "USD",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    });

    await setIcpCriteria(db, manager, channel.id, [
      { dimension: "industry", operator: "in", values: ["Software", "Fintech"], isMandatory: true },
      { dimension: "country", operator: "in", values: ["US", "GB"], isMandatory: true },
    ]);
    await setIcpCriteria(db, manager, channel.id, [
      { dimension: "seniority", operator: "in", values: ["Director", "VP", "C-Level"], isMandatory: true },
    ]);

    const criteria = await db.icpCriterion.findMany({ where: { campaignChannelId: channel.id } });
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.dimension).toBe("seniority");
    expect(criteria[0]?.createdById).toBe(manager.userId);

    // NFR-A-1: a destructive replace has to record what it destroyed, so the
    // second call's audit entry carries the two criteria it deleted.
    const audits = await db.auditLog.findMany({
      where: { entityType: "CampaignChannel", entityId: channel.id, action: "setIcpCriteria" },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.beforeJson).toEqual([]);
    // Order-insensitive: IcpCriterion has no sort column, so the read that
    // builds `before` cannot promise insertion order.
    expect(audits[1]?.beforeJson).toEqual(
      expect.arrayContaining([
        { dimension: "industry", operator: "in", values: ["Software", "Fintech"], isMandatory: true },
        { dimension: "country", operator: "in", values: ["US", "GB"], isMandatory: true },
      ]),
    );
    expect(audits[1]?.beforeJson).toHaveLength(2);
    expect(audits[1]?.afterJson).toEqual([
      { dimension: "seniority", operator: "in", values: ["Director", "VP", "C-Level"], isMandatory: true },
    ]);
  });

  it("stores the lead field spec keyed per channel", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SPEC-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const channel = await addCampaignChannel(db, manager, campaign.id, {
      channelTypeVersionId: version.id, contractedQuantity: 100,
      clientUnitPrice: "10.00", currency: "USD",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    });

    await setLeadFieldSpec(db, manager, channel.id, [
      { fieldKey: "email", label: "Work email", dataType: "email", isRequired: true, rejectIfMissing: true },
      { fieldKey: "jobTitle", label: "Job title", dataType: "string", isRequired: true, rejectIfMissing: true },
      { fieldKey: "employeeCount", label: "Employees", dataType: "number", isRequired: false, rejectIfMissing: false },
    ]);

    const spec = await db.leadFieldSpec.findMany({ where: { campaignChannelId: channel.id } });
    expect(spec).toHaveLength(3);
    expect(spec.find((f) => f.fieldKey === "email")?.dataType).toBe("email");
  });

  it("stores channel price in minor units with an explicit currency (CUR-1, CUR-6)", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CH-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    const channel = await addCampaignChannel(db, manager, campaign.id, {
      channelTypeVersionId: version.id,
      contractedQuantity: 500,
      clientUnitPrice: "42.50",
      costBudget: "10000.00",
      currency: "USD",
      startDate: new Date("2026-10-01"),
      endDate: new Date("2026-12-31"),
    });

    expect(channel.clientUnitPriceMinor).toBe(4250n);
    expect(channel.costBudgetMinor).toBe(1_000_000n);
    expect(channel.currency).toBe("USD");
  });

  it("rejects a channel whose window falls outside the campaign flight", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CH-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await expect(
      addCampaignChannel(db, manager, campaign.id, {
        channelTypeVersionId: version.id, contractedQuantity: 100,
        clientUnitPrice: "10.00", currency: "USD",
        startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks a client from reading another client's campaign (AUTH-9)", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SCOPE-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const otherClient = await createOrganization(db, { isClient: true });
    const outsider = await loadActor(db, (await createUser(db, otherClient.id, "CLIENT_ADMIN")).id);

    await expect(getCampaignForActor(db, outsider, campaign.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the owning client read its own campaign", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SCOPE-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const owner = await loadActor(db, (await createUser(db, client.id, "CLIENT_VIEWER")).id);

    const loaded = await getCampaignForActor(db, owner, campaign.id);
    expect(loaded.id).toBe(campaign.id);
  });

  describe("setIcpCriteria (channel-level)", () => {
    it("persists criteria on the channel, not the campaign", async () => {
      const { db, manager, client, version } = await setupCampaign();
      const campaign = await createCampaign(db, manager, {
        clientOrganizationId: client.id, name: "C", code: "ICP-CH-1",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
      });
      const channel = await addCampaignChannel(db, manager, campaign.id, {
        channelTypeVersionId: version.id, contractedQuantity: 100,
        clientUnitPrice: "10.00", currency: "USD",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      });

      await setIcpCriteria(db, manager, channel.id, [
        { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
      ]);

      const rows = await db.icpCriterion.findMany({ where: { campaignChannelId: channel.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dimension).toBe("country");
    });

    it("rejects if channel is not draft", async () => {
      const { db, manager, client, version } = await setupCampaign();
      const campaign = await createCampaign(db, manager, {
        clientOrganizationId: client.id, name: "C", code: "ICP-CH-2",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
      });
      const channel = await addCampaignChannel(db, manager, campaign.id, {
        channelTypeVersionId: version.id, contractedQuantity: 100,
        clientUnitPrice: "10.00", currency: "USD",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      });

      // Manually set channel status to "pending" to simulate a non-draft state
      await db.campaignChannel.update({
        where: { id: channel.id },
        data: { status: "pending" },
      });

      await expect(
        setIcpCriteria(db, manager, channel.id, [
          { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
        ]),
      ).rejects.toThrow("pending");
    });
  });
});
