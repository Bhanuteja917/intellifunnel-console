import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { eraseContactNow } from "@/lib/compliance/retention";

describe("eraseContactNow", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("scrubs a contact immediately regardless of any lead's acceptance date, and writes an audit entry", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "e@acme.com", emailNormalized: "e@acme.com", firstName: "Erin" } });

    await eraseContactNow(db, ops, contact.id);

    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstName).toBeNull();
    expect(after.anonymisedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Contact", entityId: contact.id, action: "anonymize" } });
    expect(audit.actorUserId).toBe(ops.userId);
  });

  it("rejects an actor without compliance:write", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
    const account = await db.account.create({ data: { name: "Acme", normalizedName: "acme" } });
    const contact = await db.contact.create({ data: { accountId: account.id, email: "f@acme.com", emailNormalized: "f@acme.com" } });

    await expect(eraseContactNow(db, manager, contact.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for an unknown contact id", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    await expect(eraseContactNow(db, ops, "nonexistent")).rejects.toThrow(NotFoundError);
  });
});
