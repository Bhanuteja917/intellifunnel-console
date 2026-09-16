import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  addChannelSetupStep,
  removeChannelSetupStep,
  seedChannelSetupSteps,
  setChannelStepRequirement,
} from "@/lib/channels/setup-steps";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { ValidationError } from "@/lib/errors";

async function definitionFor(channelId: string): Promise<ChannelTypeDefinition> {
  const channel = await testDb().campaignChannel.findUniqueOrThrow({
    where: { id: channelId },
    include: { channelTypeVersion: true },
  });
  return channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition;
}

async function keysFor(channelId: string) {
  const rows = await testDb().channelSetupStep.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => r.stepKey);
}

describe("seedChannelSetupSteps", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("writes the catalog default plan", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    expect(await keysFor(fx.channelId)).toEqual([
      "channelTerms",
      "icp",
      "leadSpec",
      "placement",
      "allocations",
    ]);
  });

  it("applies caller overrides over the defaults", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "placement", requirement: "optional" },
      { stepKey: "allocations", requirement: "required" },
    ]);

    const rows = await testDb().channelSetupStep.findMany({
      where: { campaignChannelId: fx.channelId },
    });
    expect(rows.find((r) => r.stepKey === "placement")?.requirement).toBe("optional");
    expect(rows.find((r) => r.stepKey === "allocations")?.requirement).toBe("required");
  });

  it("drops a default step the caller omitted from an explicit override list", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    expect(await keysFor(fx.channelId)).toEqual(["channelTerms"]);
  });

  it("always seeds a locked step even when the caller omits it", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "icp", requirement: "required" },
    ]);

    expect(await keysFor(fx.channelId)).toContain("channelTerms");
  });

  it("refuses an override for a step that does not apply to the channel type", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });

    await expect(
      seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
        { stepKey: "placement", requirement: "required" },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an override for a deferred step", async () => {
    const fx = await createChannelFixture(testDb());

    await expect(
      seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
        { stepKey: "suppressionList", requirement: "required" },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("addChannelSetupStep", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("adds an applicable step that has no row yet", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    expect(await keysFor(fx.channelId)).toEqual(["channelTerms", "icp"]);
  });

  it("defaults a newly added step to required", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "allocations" },
    });
    expect(row.requirement).toBe("required");
  });

  it("refuses a duplicate", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a deferred step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "targetAccountList"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a step that does not apply to the channel type", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "placement"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "pending" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a client actor", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      addChannelSetupStep(testDb(), fx.clientAdminActor, fx.channelId, "icp"),
    ).rejects.toThrow();
  });

  it("writes an audit row", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    const audit = await testDb().auditLog.findFirst({
      where: { entityType: "ChannelSetupStep", action: "create" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("removeChannelSetupStep", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes an unlocked step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations");

    expect(await keysFor(fx.channelId)).not.toContain("allocations");
  });

  it("refuses to remove the locked terms step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "channelTerms"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses when the step has no row", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "live" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setChannelStepRequirement", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("softens a required step to optional", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "placement", "optional");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "placement" },
    });
    expect(row.requirement).toBe("optional");
  });

  it("hardens an optional step to required", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "allocations", "required");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "allocations" },
    });
    expect(row.requirement).toBe("required");
  });

  it("refuses to soften the locked terms step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "channelTerms", "optional"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "scheduled" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "placement", "optional"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
