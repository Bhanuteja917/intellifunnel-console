import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { withAudit, writeAudit } from "@/lib/audit/audit";

describe("audit log", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("records actor, entity, action and before/after state", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    await writeAudit(db, actor, {
      entityType: "Organization",
      entityId: org.id,
      action: "update",
      before: { name: "Old" },
      after: { name: "New" },
    });

    const entry = await db.auditLog.findFirstOrThrow();
    expect(entry.actorUserId).toBe(user.id);
    expect(entry.actorOrganizationId).toBe(org.id);
    expect(entry.entityType).toBe("Organization");
    expect(entry.action).toBe("update");
    expect(entry.beforeJson).toEqual({ name: "Old" });
    expect(entry.afterJson).toEqual({ name: "New" });
  });

  it("rolls the audit entry back when the wrapped work fails", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    await expect(
      withAudit(db, actor, { entityType: "Organization", entityId: org.id, action: "update" }, async (tx) => {
        await tx.organization.update({ where: { id: org.id }, data: { name: "Renamed" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.auditLog.count()).toBe(0);
    const unchanged = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(unchanged.name).toBe(org.name);
  });

  it("rejects UPDATE and DELETE on the audit table at the database level", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);
    await writeAudit(db, actor, { entityType: "Organization", entityId: org.id, action: "create" });

    await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'tampered'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow();
  });
});
