import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { deleteUser, updateUser } from "@/lib/users/crud";

async function superAdmin(db: ReturnType<typeof testDb>) {
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("updateUser", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("updates the user's name", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    const updated = await updateUser(db, actor, target.id, { name: "New Name" });

    expect(updated.name).toBe("New Name");
  });

  it("updates the user's status", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    const updated = await updateUser(db, actor, target.id, { status: "suspended" });

    expect(updated.status).toBe("suspended");
  });

  it("replaces the user's roles", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await updateUser(db, actor, target.id, { roleCodes: ["CLIENT_ADMIN"] });

    const roles = await db.userRole.findMany({ where: { userId: target.id }, include: { role: true } });
    expect(roles.map((r) => r.role.code)).toEqual(["CLIENT_ADMIN"]);
  });

  it("rejects a role that doesn't fit the user's organisation's portal", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true, isPartner: false });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await expect(
      updateUser(db, actor, target.id, { roleCodes: ["PARTNER_ADMIN"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-Super-Admin actor", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await expect(updateUser(db, ops, target.id, { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes an audit entry", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await updateUser(db, actor, target.id, { name: "New Name" });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "User", entityId: target.id, action: "update" },
    });
    expect(audit.actorUserId).toBe(actor.userId);
  });
});

describe("deleteUser", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("soft-deletes the user", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await deleteUser(db, actor, target.id);

    const deleted = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("blocks the deleted user from loading as an actor", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await deleteUser(db, actor, target.id);

    await expect(loadActor(db, target.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to let an actor delete themself", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "SUPER_ADMIN");
    const actor = await loadActor(db, user.id);

    await expect(deleteUser(db, actor, actor.userId)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-Super-Admin actor", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });
    const target = await createUser(db, client.id, "CLIENT_VIEWER");

    await expect(deleteUser(db, ops, target.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
