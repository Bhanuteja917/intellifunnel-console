import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";

async function opsActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "OPERATIONS");
  return loadActor(db, user.id);
}

describe("resolveAccount (FR-ID-1)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("matches on normalised primary domain first", async () => {
    const db = testDb();
    const actor = await opsActor();
    const acme = await createAccount(db, actor, { name: "Acme Inc", domain: "acme.com", country: "US" });
    await createAccount(db, actor, { name: "Acme Incorporated", domain: "acme.io", country: "US" });

    const match = await resolveAccount(db, { name: "Totally Different Name", domain: "https://www.acme.com/x" });

    expect(match).toEqual({ status: "matched", accountId: acme.id, matchedOn: "domain" });
  });

  it("falls back to normalised name plus country", async () => {
    const db = testDb();
    const actor = await opsActor();
    const acme = await createAccount(db, actor, { name: "Acme Corporation", domain: "acme.com", country: "IN" });

    const match = await resolveAccount(db, { name: "  ACME  Corporation, Ltd. ", country: "IN" });

    expect(match).toEqual({ status: "matched", accountId: acme.id, matchedOn: "nameCountry" });
  });

  it("flags ambiguity rather than guessing (FR-ID-2)", async () => {
    const db = testDb();
    const actor = await opsActor();
    const a = await createAccount(db, actor, { name: "Acme", domain: "acme-one.com", country: "US" });
    const b = await createAccount(db, actor, { name: "Acme", domain: "acme-two.com", country: "US" });

    const match = await resolveAccount(db, { name: "Acme", country: "US" });

    expect(match.status).toBe("ambiguous");
    if (match.status === "ambiguous") {
      expect(match.candidateIds.sort()).toEqual([a.id, b.id].sort());
    }
  });

  it("returns unmatched when nothing fits", async () => {
    expect(await resolveAccount(testDb(), { name: "Nobody", domain: "nobody.test" }))
      .toEqual({ status: "unmatched" });
  });

});

describe("upsertContact (FR-ID-3)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("reuses the existing record for the same normalised email", async () => {
    const db = testDb();
    const actor = await opsActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });

    const first = await upsertContact(db, { email: "Jane@Acme.com", accountId: account.id, firstName: "Jane" });
    const second = await upsertContact(db, { email: "  jane@acme.com ", accountId: account.id, jobTitle: "CTO" });

    expect(second.id).toBe(first.id);
    expect(second.firstName).toBe("Jane");
    expect(second.jobTitle).toBe("CTO");
    expect(await db.contact.count()).toBe(1);
  });

  it("does not overwrite a populated field with undefined", async () => {
    const db = testDb();
    const actor = await opsActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    await upsertContact(db, { email: "jane@acme.com", accountId: account.id, phone: "+911234567890" });

    const updated = await upsertContact(db, { email: "jane@acme.com", accountId: account.id, jobTitle: "CTO" });

    expect(updated.phone).toBe("+911234567890");
  });
});
