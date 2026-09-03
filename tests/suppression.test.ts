import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createCampaign } from "@/lib/campaigns/crud";
import { ValidationError } from "@/lib/errors";
import {
  attachSuppressionList,
  importSuppressionList,
  isSuppressed,
} from "@/lib/lists/suppression";
import { createAccount } from "@/lib/identity/account-resolution";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "C", code: `SUP-${Math.random().toString(36).slice(2, 8)}`,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
  });
  return { db, ops, manager, client, campaign };
}

const CSV = ["Type,Value", "domain,https://www.Competitor.com", "email,Jane@Blocked.com", "domain,bad domain"].join("\n");
const MAPPING = { Type: "type", Value: "value" };

describe("suppression list import", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
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
    const { db, ops, manager, client, campaign } = await setup();

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

    // Attach list to campaign and verify isSuppressed matches
    await attachSuppressionList(db, manager, campaign.id, listId);
    expect(await isSuppressed(db, campaign.id, { accountId: account.id })).toBe(true);
  });
});

describe("isSuppressed", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("matches a suppressed domain for an attached list", async () => {
    const { db, ops, manager, client, campaign } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, campaign.id, listId);

    expect(await isSuppressed(db, campaign.id, { domain: "www.competitor.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { email: "someone@competitor.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { email: "JANE@blocked.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { domain: "allowed.com" })).toBe(false);
  });

  it("ignores lists not attached to the campaign", async () => {
    const { db, ops, campaign, client } = await setup();
    await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    expect(await isSuppressed(db, campaign.id, { domain: "competitor.com" })).toBe(false);
  });
});

describe("attachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("rejects attachment to a non-draft campaign", async () => {
    const { db, ops, manager, client, campaign } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    // Force campaign out of draft
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "live" } });

    await expect(() => attachSuppressionList(db, manager, campaign.id, listId)).rejects.toThrow(ValidationError);
  });
});
