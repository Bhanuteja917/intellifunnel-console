import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelApproval } from "@/lib/approvals/decisions";
import { getClientChannelDetail } from "@/lib/approvals/client-channel-view";
import { addTargetAccountEntry } from "@/lib/lists/target-accounts";
import { addSuppressionEntry } from "@/lib/lists/suppression";

describe("client channel detail read model", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("returns channel detail with ICP, lead fields and no delivery secret", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });
    await db.icpCriterion.create({
      data: {
        campaignChannelId: fx.channelId,
        dimension: "industry",
        operator: "in",
        valuesJson: ["SaaS"],
        isMandatory: true,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "companySize",
        label: "Company size",
        dataType: "number",
        isRequired: true,
        rejectIfMissing: true,
      },
    });
    await db.deliveryConfig.create({
      data: {
        campaignChannelId: fx.channelId,
        method: "webhook",
        status: "active",
        webhookUrl: "https://example.com/hook",
        webhookSecret: "super-secret-value",
        fieldMappingJson: [],
      },
    });

    const detail = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);

    expect(detail.channelId).toBe(fx.channelId);
    expect(detail.contractedQuantity).toBe(45);
    expect(detail.icp).toEqual([{ label: "Industry", value: "includes: SaaS" }]);
    expect(detail.leadFields).toEqual([{ label: "Company size", detail: "required · number" }]);
    expect(detail.deliveryConfig?.webhookUrl).toBe("https://example.com/hook");
    expect(detail.deliveryConfig).not.toHaveProperty("webhookSecret");
    expect(JSON.stringify(detail.deliveryConfig)).not.toContain("super-secret-value");
  });

  it("includes decision history with the deciding user's name", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });
    await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const detail = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);

    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]?.decision).toBe("approved");
    expect(detail.termsStatus).toBe("approved");
  });

  it("refuses a channel belonging to another organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    await expect(
      getClientChannelDetail(db, otherActor, fx.campaignId, fx.channelId),
    ).rejects.toThrow();
  });

  it("refuses a draft campaign's channel", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    await expect(
      getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId),
    ).rejects.toThrow();
  });

  it("includes target-account and suppression list summaries when attached, null otherwise", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });

    const withoutLists = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);
    expect(withoutLists.targetAccountList).toBeNull();
    expect(withoutLists.suppressionList).toBeNull();

    await addTargetAccountEntry(db, fx.adminActor, fx.channelId, { rawName: "Acme" });
    await addSuppressionEntry(db, fx.adminActor, fx.channelId, { type: "domain", value: "competitor.com" });

    const withLists = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);
    expect(withLists.targetAccountList).toEqual({
      rowCount: 1,
      downloadUrl: `/api/client/campaigns/${fx.campaignId}/channels/${fx.channelId}/target-accounts/export`,
    });
    expect(withLists.suppressionList).toEqual({
      rowCount: 1,
      downloadUrl: `/api/client/campaigns/${fx.campaignId}/channels/${fx.channelId}/suppression-list/export`,
    });
  });
});
