import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import {
  attachSuppressionList,
  importSuppressionList,
  isSuppressed,
} from "@/lib/lists/suppression";
import { createCampaignWithChannel } from "./helpers/channel-factory";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const { campaign, campaignChannel } = await createCampaignWithChannel(db, {
    clientOrganizationId: client.id,
    campaignStatus: "draft",
    channelStatus: "draft",
  });
  return { db, ops, manager, client, campaign, channel: campaignChannel };
}

const CSV = ["Company,Domain", "Competitor Inc,https://www.Competitor.com", "Blocked Co,blocked.com"].join("\n");
const MAPPING = { Company: "accountName", Domain: "accountRawDomain" };

describe("suppression list import", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("normalises the domain on import", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: CSV, mapping: MAPPING,
    });

    const entries = await db.listEntry.findMany({ where: { listId: result.listId } });
    expect(entries.map((e) => e.accountNormalizedDomain).sort()).toEqual(["blocked.com", "competitor.com"]);
  });

  it("reports a per-row error for a row with neither name nor domain", async () => {
    const { db, ops, client } = await setup();
    const content = "Company,Domain\nCompetitor,competitor.com\n,\n";

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "L", content, mapping: MAPPING,
    });

    expect(result.rowsAccepted).toBe(1);
    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.rowNumber).toBe(2);
    expect(result.errors[0]?.message).toMatch(/name or domain/i);
  });
});

describe("isSuppressed", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("matches a suppressed domain for an attached list, whether given directly or via an email", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    expect(await isSuppressed(db, channel.id, { domain: "www.competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { email: "someone@competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { email: "someone@blocked.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { domain: "allowed.com" })).toBe(false);
  });

  it("ignores lists not attached to the campaign", async () => {
    const { db, ops, channel, client } = await setup();
    await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: CSV, mapping: MAPPING,
    });

    expect(await isSuppressed(db, channel.id, { domain: "competitor.com" })).toBe(false);
  });
});

describe("attachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("rejects attachment to a non-draft channel", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: CSV, mapping: MAPPING,
    });

    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(() => attachSuppressionList(db, manager, channel.id, listId)).rejects.toThrow(ValidationError);
  });
});

describe("channel scoping (regression guard)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("does not leak a suppression list attached to one channel onto a sibling channel", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { campaignChannel: channelB } = await createCampaignWithChannel(db, {
      clientOrganizationId: client.id, campaignStatus: "draft", channelStatus: "draft",
    });
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    expect(await isSuppressed(db, channel.id, { domain: "competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channelB.id, { domain: "competitor.com" })).toBe(false);
  });

  it("replaces the channel's list rather than accumulating a second one on re-attach", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const first = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "First", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, first.listId);
    const second = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Second", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, second.listId);

    const links = await db.channelList.findMany({ where: { campaignChannelId: channel.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.listId).toBe(second.listId);
  });
});
