import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelApproval } from "@/lib/approvals/decisions";
import {
  countPendingClientApprovals,
  getClientCampaignDetail,
  getClientCampaigns,
  listClientApprovals,
} from "@/lib/approvals/client-view";

describe("client approval read models", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("lists the channel's terms as pending for its own client", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });

    const items = await listClientApprovals(db, fx.clientAdminActor);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("channelTerms");
    expect(items[0]?.subjectId).toBe(fx.channelId);
    expect(items[0]?.status).toBe("pending");
    expect(await countPendingClientApprovals(db, fx.clientAdminActor)).toBe(1);
  });

  it("stops counting an item once it is approved", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });
    await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    expect(await countPendingClientApprovals(db, fx.clientAdminActor)).toBe(0);
    const items = await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false });
    expect(items[0]?.status).toBe("approved");
  });

  it("excludes draft campaigns from the approvals list", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    expect(await listClientApprovals(db, fx.clientAdminActor)).toHaveLength(0);
    expect(await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false })).toHaveLength(0);
    expect(await countPendingClientApprovals(db, fx.clientAdminActor)).toBe(0);
  });

  it("never leaks another organisation's approvals", async () => {
    const db = testDb();
    await createChannelFixture(db, { requiresAsset: false });
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    expect(await listClientApprovals(db, otherActor)).toHaveLength(0);
    expect(await countPendingClientApprovals(db, otherActor)).toBe(0);
  });

  it("scopes an internal actor to nothing rather than everything", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    // AUTH-10: org scoping is unconditional, with no isInternal bypass. An
    // internal actor's own organisation owns no campaigns, so it sees none.
    expect(await listClientApprovals(db, fx.adminActor)).toHaveLength(0);
  });

  it("returns the campaign list with a needs-you count", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });

    const rows = await getClientCampaigns(db, fx.clientAdminActor);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.campaignId).toBe(fx.campaignId);
    expect(rows[0]?.needsYouCount).toBe(1);
    expect(rows[0]?.contractedQuantity).toBe(45);
  });

  it("excludes draft campaigns from the campaign list", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const rows = await getClientCampaigns(db, fx.clientAdminActor);

    expect(rows).toHaveLength(0);
  });

  it("returns per-channel readiness on the campaign detail", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const detail = await getClientCampaignDetail(db, fx.clientAdminActor, fx.campaignId);

    expect(detail.channels).toHaveLength(1);
    expect(detail.channels[0]?.termsStatus).toBe("pending");
    expect(detail.channels[0]?.readiness.doneCount).toBe(0);
  });

  it("never exposes the partner-allocation readiness step to the client", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const detail = await getClientCampaignDetail(db, fx.clientAdminActor, fx.campaignId);

    const stepIds = detail.channels[0]?.readiness.steps.map((s) => s.id) ?? [];
    expect(stepIds).not.toContain("allocations");
  });

  it("refuses a campaign belonging to another organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    await expect(getClientCampaignDetail(db, otherActor, fx.campaignId)).rejects.toThrow();
  });
});
