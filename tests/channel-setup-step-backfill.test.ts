import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";

const MIGRATION = "prisma/migrations/20260916000000_add_channel_setup_step/migration.sql";

/** The backfill is the one INSERT in the migration; the rest is DDL already applied. */
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const statement = sql
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.includes("INSERT INTO \"ChannelSetupStep\""));
  if (statement === undefined) throw new Error("backfill INSERT not found in migration");
  return statement;
}

async function runBackfill(): Promise<void> {
  await testDb().$executeRawUnsafe(backfillStatement());
}

async function keysFor(channelId: string) {
  const rows = await testDb().channelSetupStep.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => [r.stepKey, r.requirement]);
}

describe("channel setup step backfill", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("seeds terms, icp, lead spec, placement and allocations for a lead channel with no overrides", async () => {
    const fx = await createChannelFixture(testDb());
    await runBackfill();

    expect(await keysFor(fx.channelId)).toEqual([
      ["channelTerms", "required"],
      ["icp", "required"],
      ["leadSpec", "required"],
      ["placement", "required"],
      ["allocations", "optional"],
    ]);
  });

  it("softens placement to optional when the override said optional", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { placement: "optional" } },
    });
    await runBackfill();

    expect(await keysFor(fx.channelId)).toContainEqual(["placement", "optional"]);
  });

  it("drops placement entirely when the override said skipped", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { placement: "skipped" } },
    });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).not.toContain("placement");
  });

  it("hardens allocations to required when the override said enabled", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { allocations: "enabled" } },
    });
    await runBackfill();

    expect(await keysFor(fx.channelId)).toContainEqual(["allocations", "required"]);
  });

  it("drops placement for a channel type that needs no asset", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).toEqual([
      "channelTerms",
      "icp",
      "leadSpec",
      "allocations",
    ]);
  });

  it("seeds no icp or lead spec for an impression-only channel", async () => {
    const fx = await createChannelFixture(testDb());
    const channel = await testDb().campaignChannel.findUniqueOrThrow({
      where: { id: fx.channelId },
      include: { channelTypeVersion: true },
    });
    const definition = channel.channelTypeVersion.definitionJson as Record<string, unknown>;
    await testDb().channelTypeVersion.update({
      where: { id: channel.channelTypeVersionId },
      data: { definitionJson: { ...definition, producesLeads: false, requiresAsset: false } },
    });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).toEqual([
      "channelTerms",
      "allocations",
    ]);
  });

  it("is idempotent", async () => {
    const fx = await createChannelFixture(testDb());
    await runBackfill();
    await runBackfill();

    expect(await keysFor(fx.channelId)).toHaveLength(5);
  });
});
