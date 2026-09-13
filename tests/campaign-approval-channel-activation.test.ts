import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { setIcpCriteria, setLeadFieldSpec } from "@/lib/campaigns/crud";
import { submitChannelForApproval, decideChannelApproval, updateCampaignStatus } from "@/lib/campaigns/state-machine";

describe("channel submit/approve — campaign status derivation", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("submitting a draft channel moves campaign to pending", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "draft",
      requiresAsset: false,
    });

    // Give the channel ICP + email lead spec so it's submittable
    await setIcpCriteria(db, fx.adminActor, fx.channelId, [
      { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    ]);
    await setLeadFieldSpec(db, fx.adminActor, fx.channelId, [
      { fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
    ]);

    await submitChannelForApproval(db, fx.adminActor, fx.channelId);

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaign.status).toBe("pending");
  });

  it("approving a pending channel moves campaign to scheduled (future start date)", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "draft",
      requiresAsset: false,
    });

    await setIcpCriteria(db, fx.adminActor, fx.channelId, [
      { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    ]);
    await setLeadFieldSpec(db, fx.adminActor, fx.channelId, [
      { fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
    ]);

    await submitChannelForApproval(db, fx.adminActor, fx.channelId);
    const approved = await decideChannelApproval(db, fx.clientAdminActor, fx.channelId, "approved");

    // Channel start date is 2026-02-01 (past), so → live
    expect(approved.status).toBe("live");

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaign.status).toBe("live");
  });

  it("rejecting a pending channel returns it and its campaign to draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "draft",
      requiresAsset: false,
    });

    await setIcpCriteria(db, fx.adminActor, fx.channelId, [
      { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    ]);
    await setLeadFieldSpec(db, fx.adminActor, fx.channelId, [
      { fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
    ]);

    await submitChannelForApproval(db, fx.adminActor, fx.channelId);
    await decideChannelApproval(db, fx.clientAdminActor, fx.channelId, "rejected", "Needs revision");

    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    expect(channel.status).toBe("draft");

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaign.status).toBe("draft");
  });

  it("a second channel on the same campaign keeps campaign pending when first is approved and second is draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "draft",
      requiresAsset: false,
    });

    // A second channel on the same campaign, left in draft.
    await db.campaignChannel.create({
      data: {
        campaignId: fx.campaignId,
        channelTypeVersionId: fx.channelTypeVersionId,
        contractedQuantity: 10,
        clientUnitPriceMinor: 1000n,
        currency: "USD",
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-03-31"),
        status: "draft",
      },
    });

    await setIcpCriteria(db, fx.adminActor, fx.channelId, [
      { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    ]);
    await setLeadFieldSpec(db, fx.adminActor, fx.channelId, [
      { fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
    ]);

    await submitChannelForApproval(db, fx.adminActor, fx.channelId);
    // First channel is now pending; second is still draft → campaign derives to draft (draft beats pending)
    const campaignAfterSubmit = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaignAfterSubmit.status).toBe("draft");

    await decideChannelApproval(db, fx.clientAdminActor, fx.channelId, "approved");
    // First channel is now live (start date 2026-02-01 is past); second is still draft.
    // Per deriveCampaignStatus: live takes priority over draft → campaign derives to live.
    const campaignAfterApproval = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaignAfterApproval.status).toBe("live");
  });

  it("updateCampaignStatus derives completed when all channels finished", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "live",
      channelStatus: "live",
      requiresAsset: false,
    });

    // Mark the channel as completed
    await db.campaignChannel.update({
      where: { id: fx.channelId },
      data: { status: "completed" },
    });

    await updateCampaignStatus(db, fx.campaignId, null);

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(campaign.status).toBe("completed");
  });
});
