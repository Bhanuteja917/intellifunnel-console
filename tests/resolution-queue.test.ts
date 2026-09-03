import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount } from "@/lib/identity/account-resolution";
import { importTargetAccountList } from "@/lib/lists/target-accounts";
import {
  listUnresolvedEntries,
  rematchEntry,
  resolveEntryByCreatingAccount,
  resolveEntryToAccount,
} from "@/lib/identity/resolution-queue";
import { ForbiddenError } from "@/lib/errors";

const CSV = ["Company,Website", "Acme Inc,https://www.acme.com", "Mystery Co,mystery.test"].join("\n");
const MAPPING = { Company: "rawName", Website: "rawDomain" };

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const client = await createOrganization(db, { isClient: true });
  const { listId } = await importTargetAccountList(db, ops, {
    ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
  });
  return { db, ops, client, listId };
}

describe("account resolution queue (FR-ID-2)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("lists unmatched and ambiguous entries, and no matched ones", async () => {
    const { db, ops, listId } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const acmeEntry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });
    await resolveEntryToAccount(db, ops, acmeEntry.id, acme.id);

    const { entries } = await listUnresolvedEntries(db, ops, { listId });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.rawName).toBe("Mystery Co");
  });

  it("assigns an entry to an existing account", async () => {
    const { db, ops } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });

    await resolveEntryToAccount(db, ops, entry.id, acme.id);

    const updated = await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updated.matchStatus).toBe("matched");
    expect(updated.accountId).toBe(acme.id);
  });

  it("creates an account from the entry when none exists", async () => {
    const { db, ops } = await setup();
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Mystery Co" } });

    const { accountId } = await resolveEntryByCreatingAccount(db, ops, entry.id);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.name).toBe("Mystery Co");
    expect(account.primaryDomain).toBe("mystery.test");
    const updated = await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updated.accountId).toBe(accountId);
    expect(updated.matchStatus).toBe("matched");
  });

  it("rematches an entry after the account it should match is created", async () => {
    const { db, ops } = await setup();
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });
    expect(entry.matchStatus).toBe("unmatched");
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });

    const status = await rematchEntry(db, ops, entry.id);

    expect(status).toBe("matched");
    expect((await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } })).accountId).toBe(acme.id);
  });

  it("audits a manual resolution", async () => {
    const { db, ops } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });

    await resolveEntryToAccount(db, ops, entry.id, acme.id);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "TargetAccountEntry", action: "resolve" },
    });
    expect(audit.actorUserId).toBe(ops.userId);
  });

  it("refuses a client actor", async () => {
    const { db, client, listId } = await setup();
    const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);

    await expect(listUnresolvedEntries(db, clientAdmin, { listId }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("pages with a cursor", async () => {
    const { db, ops, client } = await setup();
    const many = ["Company,Website", ...Array.from({ length: 5 }, (_, i) => `Co ${i},co${i}.test`)].join("\n");
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Big TAL", content: many, mapping: MAPPING,
    });

    const first = await listUnresolvedEntries(db, ops, { listId, limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listUnresolvedEntries(db, ops, { listId, limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0]?.id).not.toBe(first.entries[0]?.id);
  });
});
