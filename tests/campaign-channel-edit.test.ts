import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";
import { submitChannelForApproval } from "@/lib/campaigns/state-machine";
import { decideChannelApproval } from "@/lib/approvals/decisions";
import { getChannelApprovalStatus } from "@/lib/approvals/status";
import { setChannelStepRequirement } from "@/lib/channels/setup-steps";
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
    await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const updated = await updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit);

    expect(await getChannelApprovalStatus(db, updated)).toBe("reapprovalNeeded");
  });

  it("refuses once the campaign is past draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "pending" });

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

  it("refuses when end date precedes start date", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, {
        ...validEdit,
        startDate: new Date("2026-03-31"),
        endDate: new Date("2026-02-01"),
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

  it("unblocks submission when the placement step is softened to optional", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await db.icpCriterion.create({
      data: {
        campaignChannelId: fx.channelId,
        dimension: "country",
        operator: "in",
        valuesJson: ["US"],
        isMandatory: true,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    await setChannelStepRequirement(db, fx.adminActor, fx.channelId, "placement", "optional");

    const submitted = await submitChannelForApproval(db, fx.adminActor, fx.channelId);
    expect(submitted.status).toBe("pending");
  });
});

describe("setChannelStatus", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to set live when the campaign is still draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "draft" });

    await expect(
      setChannelStatus(db, fx.adminActor, { channelId: fx.channelId, status: "live" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activates a ready channel on a scheduled campaign", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "scheduled", channelStatus: "scheduled", requiresAsset: false });

    const updated = await setChannelStatus(db, fx.adminActor, {
      channelId: fx.channelId,
      status: "live",
    });
    expect(updated.status).toBe("live");
  });

  it("refuses to activate while the campaign is still a draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    await expect(
      setChannelStatus(db, fx.adminActor, { channelId: fx.channelId, status: "live" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("pauses and resumes an active channel without re-checking readiness", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "live",
      channelStatus: "live",
      requiresAsset: true,
    });

    const paused = await setChannelStatus(db, fx.adminActor, {
      channelId: fx.channelId,
      status: "paused",
    });
    expect(paused.status).toBe("paused");

    const resumed = await setChannelStatus(db, fx.adminActor, {
      channelId: fx.channelId,
      status: "live",
    });
    expect(resumed.status).toBe("live");
  });

  it("refuses a status this control does not own", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "live", channelStatus: "live" });

    await expect(
      setChannelStatus(db, fx.adminActor, { channelId: fx.channelId, status: "completed" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
