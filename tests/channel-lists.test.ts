import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createCampaignWithChannel } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  addTargetAccountEntry,
  attachTargetAccountList,
  detachTargetAccountList,
  exportTargetAccountListCsv,
  importAndAttachTargetAccountList,
  importTargetAccountList,
  removeTargetAccountEntry,
} from "@/lib/lists/target-accounts";
import {
  addSuppressionEntry,
  attachSuppressionList,
  detachSuppressionList,
  exportSuppressionListCsv,
  importAndAttachSuppressionList,
  importSuppressionList,
  removeSuppressionEntry,
} from "@/lib/lists/suppression";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const client = await createOrganization(db, { isClient: true });
  const { campaignChannel } = await createCampaignWithChannel(db, {
    clientOrganizationId: client.id,
    campaignStatus: "draft",
    channelStatus: "draft",
  });
  return { db, manager, ops, client, channel: campaignChannel };
}

describe("addTargetAccountEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("creates a 'Manual entries' list on the first add and reuses it on the second", async () => {
    const { db, manager, channel } = await setup();

    const first = await addTargetAccountEntry(db, manager, channel.id, { accountName: "Acme" });
    const second = await addTargetAccountEntry(db, manager, channel.id, { accountRawDomain: "globex.com" });

    const link = await db.channelList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    const list = await db.list.findUniqueOrThrow({ where: { id: link.listId } });
    expect(list.name).toBe("Manual entries");
    expect(list.type).toBe("targetAccounts");
    const entries = await db.listEntry.findMany({ where: { listId: link.listId } });
    expect(entries.map((e) => e.id).sort()).toEqual([first.entryId, second.entryId].sort());
  });

  it("normalizes the domain of a manually added entry", async () => {
    const { db, manager, channel } = await setup();

    const { entryId } = await addTargetAccountEntry(db, manager, channel.id, { accountRawDomain: "https://www.Acme.com" });

    const entry = await db.listEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.accountNormalizedDomain).toBe("acme.com");
  });

  it("rejects an entry with neither name nor domain", async () => {
    const { db, manager, channel } = await setup();
    await expect(addTargetAccountEntry(db, manager, channel.id, {})).rejects.toThrow(ValidationError);
  });

  it("rejects a non-positive cap override", async () => {
    const { db, manager, channel } = await setup();
    await expect(
      addTargetAccountEntry(db, manager, channel.id, { accountName: "Acme", maxLeadsPerAccountOverride: 0 }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to add when the channel is not draft", async () => {
    const { db, manager, channel } = await setup();
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });
    await expect(addTargetAccountEntry(db, manager, channel.id, { accountName: "Acme" })).rejects.toThrow(ValidationError);
  });
});

describe("removeTargetAccountEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("deletes an entry that belongs to the channel's list", async () => {
    const { db, manager, channel } = await setup();
    const { entryId } = await addTargetAccountEntry(db, manager, channel.id, { accountName: "Acme" });

    await removeTargetAccountEntry(db, manager, channel.id, entryId);

    expect(await db.listEntry.findUnique({ where: { id: entryId } })).toBeNull();
  });

  it("refuses to delete an entry belonging to a different channel", async () => {
    const { db, manager, channel } = await setup();
    const other = await createCampaignWithChannel(db, { campaignStatus: "draft", channelStatus: "draft" });
    const { entryId } = await addTargetAccountEntry(db, manager, other.campaignChannel.id, { accountName: "Other Co" });

    await expect(removeTargetAccountEntry(db, manager, channel.id, entryId)).rejects.toThrow(NotFoundError);
  });
});

describe("detachTargetAccountList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes the channel's link but keeps the underlying list", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: "Company\nAcme\n", mapping: { Company: "accountName" },
    });
    await attachTargetAccountList(db, manager, channel.id, listId);

    await detachTargetAccountList(db, manager, channel.id);

    expect(await db.channelList.findFirst({ where: { campaignChannelId: channel.id } })).toBeNull();
    expect(await db.list.findUnique({ where: { id: listId } })).not.toBeNull();
  });

  it("refuses to detach when the channel is not draft", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: "Company\nAcme\n", mapping: { Company: "accountName" },
    });
    await attachTargetAccountList(db, manager, channel.id, listId);
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(detachTargetAccountList(db, manager, channel.id)).rejects.toThrow(ValidationError);
  });
});

describe("exportTargetAccountListCsv", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns null when no list is attached", async () => {
    const { db, manager, channel } = await setup();
    expect(await exportTargetAccountListCsv(db, manager, channel.id)).toBeNull();
  });

  it("returns a CSV with a header row and one row per entry", async () => {
    const { db, manager, channel } = await setup();
    await addTargetAccountEntry(db, manager, channel.id, { accountName: "Acme", accountRawDomain: "acme.com" });

    const csv = await exportTargetAccountListCsv(db, manager, channel.id);

    expect(csv).toContain("name,domain,maxLeadsPerAccountOverride");
    expect(csv).toContain("Acme,acme.com");
  });
});

describe("importAndAttachTargetAccountList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("imports a CSV and attaches the resulting list to the channel in one call", async () => {
    const { db, manager, channel } = await setup();

    const result = await importAndAttachTargetAccountList(db, manager, channel.id, {
      name: "Q4 TAL", content: "Company\nAcme\n", mapping: { Company: "accountName" },
    });

    const link = await db.channelList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    expect(link.listId).toBe(result.listId);
  });
});

describe("addSuppressionEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("creates a 'Manual entries' list on the first add and reuses it on the second", async () => {
    const { db, manager, channel } = await setup();

    const first = await addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "competitor.com" });
    const second = await addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "blocked.com" });

    const link = await db.channelList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    const list = await db.list.findUniqueOrThrow({ where: { id: link.listId } });
    expect(list.name).toBe("Manual entries");
    expect(list.type).toBe("suppression");
    const entries = await db.listEntry.findMany({ where: { listId: link.listId } });
    expect(entries.map((e) => e.id).sort()).toEqual([first.entryId, second.entryId].sort());
  });

  it("normalizes the domain", async () => {
    const { db, manager, channel } = await setup();

    const { entryId } = await addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "https://www.Competitor.com" });

    const entry = await db.listEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.accountNormalizedDomain).toBe("competitor.com");
  });

  it("refuses to add when the channel is not draft", async () => {
    const { db, manager, channel } = await setup();
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });
    await expect(
      addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "competitor.com" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("removeSuppressionEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("deletes an entry that belongs to the channel's list", async () => {
    const { db, manager, channel } = await setup();
    const { entryId } = await addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "competitor.com" });

    await removeSuppressionEntry(db, manager, channel.id, entryId);

    expect(await db.listEntry.findUnique({ where: { id: entryId } })).toBeNull();
  });

  it("refuses to delete an entry belonging to a different channel", async () => {
    const { db, manager, channel } = await setup();
    const other = await createCampaignWithChannel(db, { campaignStatus: "draft", channelStatus: "draft" });
    const { entryId } = await addSuppressionEntry(db, manager, other.campaignChannel.id, { accountRawDomain: "other.com" });

    await expect(removeSuppressionEntry(db, manager, channel.id, entryId)).rejects.toThrow(NotFoundError);
  });
});

describe("detachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes the channel's link but keeps the underlying list", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: "Domain\ncompetitor.com\n", mapping: { Domain: "accountRawDomain" },
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    await detachSuppressionList(db, manager, channel.id);

    expect(await db.channelList.findFirst({ where: { campaignChannelId: channel.id } })).toBeNull();
    expect(await db.list.findUnique({ where: { id: listId } })).not.toBeNull();
  });

  it("refuses to detach when the channel is not draft", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors",
      content: "Domain\ncompetitor.com\n", mapping: { Domain: "accountRawDomain" },
    });
    await attachSuppressionList(db, manager, channel.id, listId);
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(detachSuppressionList(db, manager, channel.id)).rejects.toThrow(ValidationError);
  });
});

describe("exportSuppressionListCsv", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns null when no list is attached", async () => {
    const { db, manager, channel } = await setup();
    expect(await exportSuppressionListCsv(db, manager, channel.id)).toBeNull();
  });

  it("returns a CSV with a header row and one row per entry", async () => {
    const { db, manager, channel } = await setup();
    await addSuppressionEntry(db, manager, channel.id, { accountRawDomain: "competitor.com" });

    const csv = await exportSuppressionListCsv(db, manager, channel.id);

    expect(csv).toContain("name,domain");
    expect(csv).toContain("competitor.com");
  });
});

describe("importAndAttachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("imports a CSV and attaches the resulting list to the channel in one call", async () => {
    const { db, manager, channel } = await setup();

    const result = await importAndAttachSuppressionList(db, manager, channel.id, {
      name: "Competitors",
      content: "Domain\ncompetitor.com\n", mapping: { Domain: "accountRawDomain" },
    });

    const link = await db.channelList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    expect(link.listId).toBe(result.listId);
  });
});
