import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";
import { ACCOUNT_MERGE_REVERSAL_HOURS, mergeAccounts, unmergeAccounts } from "@/lib/identity/merge";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function adminActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("mergeAccounts (FR-ID-4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("moves contacts and aliases to the target and marks the source merged", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com", country: "US" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com", country: "US" });
    const contact = await upsertContact(db, { email: "jane@acme-co.com", accountId: source.id });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).accountId).toBe(target.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBe(target.id);
    // The source's domain becomes an alias of the target so future lookups land right.
    const alias = await db.accountAlias.findUniqueOrThrow({ where: { value: "acme-co.com" } });
    expect(alias.accountId).toBe(target.id);
  });

  it("routes a lookup for the merged domain to the target", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com", country: "US" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com", country: "US" });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    expect(await resolveAccount(db, { domain: "acme-co.com" }))
      .toEqual({ status: "matched", accountId: target.id, matchedOn: "alias" });
  });

  it("writes an audit entry", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Account", action: "merge" },
    });
    expect(entry.actorUserId).toBe(actor.userId);
  });

  it("refuses to merge an account into itself", async () => {
    const db = testDb();
    const actor = await adminActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });

    await expect(
      mergeAccounts(db, actor, { sourceAccountId: account.id, targetAccountId: account.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires the account:merge permission", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "OPERATIONS");
    const ops = await loadActor(db, user.id);
    const admin = await adminActor();
    const target = await createAccount(db, admin, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, admin, { name: "Acme Co", domain: "acme-co.com" });

    await expect(
      mergeAccounts(db, ops, { sourceAccountId: source.id, targetAccountId: target.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reverses within the window", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });
    const contact = await upsertContact(db, { email: "jane@acme-co.com", accountId: source.id });
    const { mergeId } = await mergeAccounts(db, actor, {
      sourceAccountId: source.id, targetAccountId: target.id,
    });

    await unmergeAccounts(db, actor, mergeId);

    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).accountId).toBe(source.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBeNull();
  });

  it("refuses to reverse past the window", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });
    const { mergeId } = await mergeAccounts(db, actor, {
      sourceAccountId: source.id, targetAccountId: target.id,
    });
    await db.accountMerge.update({
      where: { id: mergeId },
      data: { mergedAt: new Date(Date.now() - (ACCOUNT_MERGE_REVERSAL_HOURS + 1) * 3_600_000) },
    });

    await expect(unmergeAccounts(db, actor, mergeId)).rejects.toBeInstanceOf(ValidationError);
  });
});
