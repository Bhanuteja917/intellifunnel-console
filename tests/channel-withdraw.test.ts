import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  submitChannelForApproval,
  withdrawChannelFromApproval,
} from "@/lib/campaigns/state-machine";
import { InvalidStateTransitionError } from "@/lib/errors";

async function submittedFixture(options: Parameters<typeof createChannelFixture>[1] = {}) {
  const fx = await createChannelFixture(testDb(), {
    producesLeads: false,
    requiresAsset: false,
    ...options,
  });
  await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);
  return fx;
}

describe("withdrawChannelFromApproval", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns a pending channel to draft", async () => {
    const fx = await submittedFixture();

    const updated = await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("draft");
  });

  it("writes no approval row", async () => {
    const fx = await submittedFixture();

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const approvals = await testDb().channelApproval.count({
      where: { campaignChannelId: fx.channelId },
    });
    expect(approvals).toBe(0);
  });

  it("audits the transition with a withdrawn reason", async () => {
    const fx = await submittedFixture();

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const audit = await testDb().auditLog.findFirst({
      where: { entityType: "CampaignChannel", entityId: fx.channelId, action: "transition:draft" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterJson)).toContain("withdrawn");
  });

  it("re-derives the campaign back to draft", async () => {
    const fx = await submittedFixture();
    const before = await testDb().campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(before.status).toBe("pending");

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const after = await testDb().campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(after.status).toBe("draft");
  });

  it("lets the channel be submitted again afterwards", async () => {
    const fx = await submittedFixture();
    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const resubmitted = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(resubmitted.status).toBe("pending");
  });

  it("refuses a channel that is still a draft", async () => {
    const fx = await createChannelFixture(testDb(), { producesLeads: false, requiresAsset: false });

    await expect(
      withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("refuses a live channel", async () => {
    const fx = await createChannelFixture(testDb(), {
      producesLeads: false,
      requiresAsset: false,
      channelStatus: "live",
    });

    await expect(
      withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("refuses an actor without campaign:submitInternal", async () => {
    const fx = await submittedFixture();

    await expect(
      withdrawChannelFromApproval(testDb(), fx.clientAdminActor, fx.channelId),
    ).rejects.toThrow();
  });
});
