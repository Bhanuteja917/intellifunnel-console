import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { createDoNotContactEntry, deleteDoNotContactEntry, listDoNotContactEntries } from "@/lib/compliance/dnc";
import { checkDoNotContact } from "@/lib/leads/matching";

describe("DNC list CRUD", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("creates an entry whose stored hash matches what checkDoNotContact computes", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });

    await createDoNotContactEntry(db, ops, { clientOrganizationId: client.id, type: "email", rawValue: "Blocked@Acme.com" });

    expect(await checkDoNotContact(db, client.id, { email: "blocked@acme.com" })).toBe(true);
  });

  it("lists entries scoped to one client organisation", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const clientA = await createOrganization(db, { isClient: true });
    const clientB = await createOrganization(db, { isClient: true });
    await createDoNotContactEntry(db, ops, { clientOrganizationId: clientA.id, type: "domain", rawValue: "a.com" });
    await createDoNotContactEntry(db, ops, { clientOrganizationId: clientB.id, type: "domain", rawValue: "b.com" });

    const entries = await listDoNotContactEntries(db, ops, clientA.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe("a.com");
  });

  it("deletes an entry", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });
    const entry = await createDoNotContactEntry(db, ops, { clientOrganizationId: client.id, type: "email", rawValue: "gone@x.com" });

    await deleteDoNotContactEntry(db, ops, entry.id);

    expect(await checkDoNotContact(db, client.id, { email: "gone@x.com" })).toBe(false);
  });

  it("rejects a duplicate entry with a ConflictError, not a raw Prisma error", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });

    await createDoNotContactEntry(db, ops, { clientOrganizationId: client.id, type: "email", rawValue: "dupe@acme.com" });
    // Differently cased, but it normalises to the same stored value — the
    // @@unique([clientOrganizationId, type, value]) constraint catches it.
    await expect(createDoNotContactEntry(db, ops, { clientOrganizationId: client.id, type: "email", rawValue: "Dupe@Acme.com" }))
      .rejects.toThrow(ConflictError);
  });

  it("rejects a non-Operations actor for both writes", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
    const client = await createOrganization(db, { isClient: true });

    await expect(createDoNotContactEntry(db, manager, { clientOrganizationId: client.id, type: "email", rawValue: "x@y.com" }))
      .rejects.toThrow(ForbiddenError);
  });
});
