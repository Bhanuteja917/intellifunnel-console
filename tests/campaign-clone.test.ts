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
  setIcpCriteria,
  setLeadFieldSpec,
} from "@/lib/campaigns/crud";
import { decideClientApproval, decideInternalApproval, submitForInternalApproval } from "@/lib/campaigns/state-machine";
import { cloneCampaign } from "@/lib/campaigns/clone";
import { NotFoundError, ValidationError } from "@/lib/errors";

async function configuredCampaign(code: string) {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);
  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);

  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "Original", code,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    currency: "USD", defaultMaxLeadsPerAccount: 5,
  });
  await setIcpCriteria(db, manager, campaign.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    { dimension: "seniority", operator: "in", values: ["VP"], isMandatory: false },
  ]);
  await setLeadFieldSpec(db, manager, campaign.id, [
    { fieldKey: "email", label: "Work email", dataType: "email", isRequired: true, rejectIfMissing: true },
  ]);
  await addCampaignChannel(db, manager, campaign.id, {
    channelTypeVersionId: version.id, contractedQuantity: 500,
    clientUnitPrice: "42.50", costBudget: "10000.00", currency: "USD",
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
  });

  return { db, manager, clientAdmin, client, campaign, version };
}

describe("cloneCampaign (E3)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("refuses to retarget a clone at an organisation that is not a client", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-ORG");
    const partnerOnly = await createOrganization(db, { isClient: false, isPartner: true });

    await expect(
      cloneCampaign(db, manager, campaign.id, {
        code: "CLONE-NOT-CLIENT",
        clientOrganizationId: partnerOnly.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.campaign.findUnique({ where: { code: "CLONE-NOT-CLIENT" } })).toBeNull();
  });

  it("refuses to retarget a clone at a soft-deleted organisation", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-DEL");
    const gone = await createOrganization(db, { isClient: true });
    await db.organization.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    await expect(
      cloneCampaign(db, manager, campaign.id, {
        code: "CLONE-DELETED-ORG",
        clientOrganizationId: gone.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await db.campaign.findUnique({ where: { code: "CLONE-DELETED-ORG" } })).toBeNull();
  });

  it("copies ICP, lead field spec and channels into a new draft", async () => {
    const { db, manager, campaign, version } = await configuredCampaign("CLONE-SRC-1");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-1", name: "Q1 rerun",
      startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    expect(clone.status).toBe("draft");
    expect(clone.name).toBe("Q1 rerun");
    expect(clone.clonedFromCampaignId).toBe(campaign.id);
    expect(clone.defaultMaxLeadsPerAccount).toBe(5);

    const criteria = await db.icpCriterion.findMany({ where: { campaignId: clone.id } });
    expect(criteria).toHaveLength(2);

    const spec = await db.leadFieldSpec.findMany({ where: { campaignId: clone.id } });
    expect(spec.map((f) => f.fieldKey)).toEqual(["email"]);

    const channels = await db.campaignChannel.findMany({ where: { campaignId: clone.id } });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.channelTypeVersionId).toBe(version.id);
    expect(channels[0]?.clientUnitPriceMinor).toBe(4250n);
    expect(channels[0]?.status).toBe("draft");
  });

  it("shifts channel windows into the clone's flight window", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-2");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-2", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    const channel = await db.campaignChannel.findFirstOrThrow({ where: { campaignId: clone.id } });
    expect(channel.startDate.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(channel.endDate.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("copies attached target account and suppression list links", async () => {
    const { db, manager, campaign, client } = await configuredCampaign("CLONE-SRC-3");
    const list = await db.targetAccountList.create({
      data: { ownerOrganizationId: client.id, name: "TAL" },
    });
    await db.campaignTargetAccountList.create({ data: { campaignId: campaign.id, listId: list.id } });

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-3", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    const links = await db.campaignTargetAccountList.findMany({ where: { campaignId: clone.id } });
    expect(links.map((l) => l.listId)).toEqual([list.id]);
  });

  it("copies no approvals, snapshot or status history from the source", async () => {
    const { db, manager, clientAdmin, client, campaign } = await configuredCampaign("CLONE-SRC-4");

    // CONTENT_SYNDICATION is seeded requiresAsset:true (E5) — give the
    // channel an active placement so approval can proceed.
    const channel = await db.campaignChannel.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const asset = await db.asset.create({
      data: { ownerOrganizationId: client.id, name: "Whitepaper", type: "whitepaper", language: "en" },
    });
    const assetVersion = await db.assetVersion.create({
      data: {
        assetId: asset.id, version: 1, storageKey: `assets/${asset.id}/1-whitepaper.pdf`,
        fileName: "whitepaper.pdf", mimeType: "application/pdf", sizeBytes: 1024,
      },
    });
    await db.assetPlacement.create({
      data: {
        campaignChannelId: channel.id, assetId: asset.id, assetVersionId: assetVersion.id,
        landingPageUrl: "https://client.example.com/landing", formSlug: "form-clone-src-4",
        status: "active",
      },
    });

    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-4", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    expect(clone.approvedSnapshotId).toBeNull();
    expect(await db.campaignApproval.count({ where: { campaignId: clone.id } })).toBe(0);
    const history = await db.campaignStatusHistory.findMany({ where: { campaignId: clone.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe("draft");
  });

  it("rejects a clone code that already exists", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-5");

    await expect(
      cloneCampaign(db, manager, campaign.id, {
        code: "CLONE-SRC-5", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
