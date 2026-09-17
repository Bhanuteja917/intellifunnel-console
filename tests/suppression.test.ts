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
import { createAccount } from "@/lib/identity/account-resolution";
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

const CSV = ["Type,Value", "domain,https://www.Competitor.com", "email,Jane@Blocked.com", "domain,bad domain"].join("\n");
const MAPPING = { Type: "type", Value: "value" };

describe("suppression list import", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("normalises domains and emails on import", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    const entries = await db.suppressionEntry.findMany({ where: { listId: result.listId } });
    expect(entries.map((e) => e.value).sort()).toEqual(["competitor.com", "jane@blocked.com"]);
  });

  it("stores a salted hash alongside the value (FR-CP-6)", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    const entry = await db.suppressionEntry.findFirstOrThrow({ where: { listId: result.listId } });
    expect(entry.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.valueHash).not.toBe(entry.value);
  });

  it("reports a per-row error for an unparseable value", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    expect(result.rowsAccepted).toBe(2);
    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.rowNumber).toBe(3);
  });

  it("rejects an unknown entry type", async () => {
    const { db, ops, client } = await setup();
    const content = "Type,Value\nfax,12345\n";

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "L", type: "custom", content, mapping: MAPPING,
    });

    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.message).toMatch(/type/i);
  });

  it("resolves account type entries and sets accountId on matched accounts", async () => {
    const { db, ops, manager, client, channel } = await setup();

    // Create an account with a domain
    const account = await createAccount(db, ops, {
      name: "Acme Corp",
      domain: "acme.com",
    });

    // Import suppression list with account type
    const content = "Type,Value\naccount,acme.com\n";
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "AccountSuppression", type: "custom",
      content, mapping: MAPPING,
    });

    // Verify the entry has the correct accountId
    const entry = await db.suppressionEntry.findFirstOrThrow({
      where: { listId, type: "account" },
    });
    expect(entry.accountId).toBe(account.id);

    // Attach list to channel and verify isSuppressed matches
    await attachSuppressionList(db, manager, channel.id, listId);
    expect(await isSuppressed(db, channel.id, { accountId: account.id })).toBe(true);
  });
});

describe("isSuppressed", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
  });

  it("matches a suppressed domain for an attached list", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    expect(await isSuppressed(db, channel.id, { domain: "www.competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { email: "someone@competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { email: "JANE@blocked.com" })).toBe(true);
    expect(await isSuppressed(db, channel.id, { domain: "allowed.com" })).toBe(false);
  });

  it("ignores lists not attached to the campaign", async () => {
    const { db, ops, channel, client } = await setup();
    await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
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
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
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
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    expect(await isSuppressed(db, channel.id, { domain: "competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channelB.id, { domain: "competitor.com" })).toBe(false);
  });

  it("replaces the channel's list rather than accumulating a second one on re-attach", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const first = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "First", type: "competitor", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, first.listId);
    const second = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Second", type: "competitor", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, second.listId);

    const links = await db.channelSuppressionList.findMany({ where: { campaignChannelId: channel.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.listId).toBe(second.listId);
  });
});
