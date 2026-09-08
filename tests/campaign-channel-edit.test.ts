import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { getChannelTermsApprovalStatus } from "@/lib/approvals/status";
import { ValidationError } from "@/lib/errors";

const validEdit = {
  contractedQuantity: 60,
  clientUnitPrice: "30.00",
  currency: "USD",
  startDate: new Date("2026-02-01"),
  endDate: new Date("2026-03-31"),
};

describe("updateCampaignChannel", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("updates terms on a draft campaign", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const updated = await updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit);

    expect(updated.contractedQuantity).toBe(60);
    expect(updated.clientUnitPriceMinor).toBe(3000n);
  });

  it("invalidates an existing approval by making the snapshot stale", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const updated = await updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit);

    expect(await getChannelTermsApprovalStatus(db, updated)).toBe("reapprovalNeeded");
  });

  it("refuses once the campaign is past draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "pendingInternalApproval" });

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a currency that differs from the campaign's", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, { ...validEdit, currency: "GBP" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a window outside the campaign flight", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, {
        ...validEdit,
        endDate: new Date("2027-06-01"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a fractional quantity", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, {
        ...validEdit,
        contractedQuantity: 1.5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setChannelStatus", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to activate a channel that is not ready", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "scheduled" });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activates a ready channel on a scheduled campaign", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "scheduled", requiresAsset: false });
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const updated = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("refuses to activate while the campaign is still a draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("pauses and resumes an active channel without re-checking readiness", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "live",
      channelStatus: "active",
      requiresAsset: true,
    });

    const paused = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "paused",
    });
    expect(paused.status).toBe("paused");

    const resumed = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "active",
    });
    expect(resumed.status).toBe("active");
  });

  it("refuses a status this control does not own", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "live", channelStatus: "active" });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "completed" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
