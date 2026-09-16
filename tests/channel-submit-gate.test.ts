import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { submitChannelForApproval } from "@/lib/campaigns/state-machine";
import { setChannelStepRequirement, removeChannelSetupStep } from "@/lib/channels/setup-steps";
import { ValidationError } from "@/lib/errors";

async function satisfyLeadSteps(channelId: string) {
  await testDb().icpCriterion.create({
    data: {
      campaignChannelId: channelId,
      dimension: "country",
      operator: "in",
      valuesJson: ["US"],
      isMandatory: true,
    },
  });
  await testDb().leadFieldSpec.create({
    data: {
      campaignChannelId: channelId,
      fieldKey: "email",
      label: "Email",
      dataType: "email",
      isRequired: true,
      rejectIfMissing: true,
    },
  });
}

describe("submitChannelForApproval — step-driven gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("submits an impression-only channel with no ICP and no lead spec", async () => {
    const fx = await createChannelFixture(testDb(), { producesLeads: false, requiresAsset: false });

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("refuses a lead channel missing its ICP, naming the step", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toThrow(/Define the ICP/);
  });

  it("submits once every required step is done", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("ignores an incomplete optional step", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);
    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "icp", "optional");
    await testDb().icpCriterion.deleteMany({ where: { campaignChannelId: fx.channelId } });

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("blocks on an incomplete step the operator hardened to required", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);
    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "allocations", "required");

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toThrow(/Allocate partner quota/);
  });

  it("submits a lead channel whose ICP step the operator removed", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await testDb().leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });
    await removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("blocks a channel that needs an asset until a placement is active", async () => {
    const fx = await createChannelFixture(testDb());
    await satisfyLeadSteps(fx.channelId);

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
