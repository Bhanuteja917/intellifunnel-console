import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { archiveOrganization } from "@/lib/organizations/crud";

async function superAdmin(db: ReturnType<typeof testDb>) {
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

async function campaignFor(db: ReturnType<typeof testDb>, clientOrganizationId: string, status: string) {
  return db.campaign.create({
    data: {
      clientOrganizationId,
      name: "Test Campaign",
      code: `CAM-${Date.now()}-${Math.random()}`,
      status: status as never,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
    },
  });
}

describe("archiveOrganization", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("archives an organisation with no active campaigns", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });

    const archived = await archiveOrganization(db, actor, client.id);

    expect(archived.status).toBe("archived");
  });

  for (const status of ["live", "paused", "scheduled"]) {
    it(`refuses to archive an organisation with a ${status} campaign`, async () => {
      const db = testDb();
      const actor = await superAdmin(db);
      const client = await createOrganization(db, { isClient: true });
      await campaignFor(db, client.id, status);

      await expect(archiveOrganization(db, actor, client.id)).rejects.toBeInstanceOf(ValidationError);

      const unchanged = await db.organization.findUniqueOrThrow({ where: { id: client.id } });
      expect(unchanged.status).toBe("active");
    });
  }

  for (const status of ["draft", "pending", "completed", "cancelled"]) {
    it(`allows archiving with a ${status} campaign (not active)`, async () => {
      const db = testDb();
      const actor = await superAdmin(db);
      const client = await createOrganization(db, { isClient: true });
      await campaignFor(db, client.id, status);

      const archived = await archiveOrganization(db, actor, client.id);

      expect(archived.status).toBe("archived");
    });
  }

  it("rejects a non-Super-Admin actor", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });

    await expect(archiveOrganization(db, ops, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks every user of the archived organisation from loading as an actor", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });
    const clientUser = await createUser(db, client.id, "CLIENT_ADMIN");

    await archiveOrganization(db, actor, client.id);

    await expect(loadActor(db, clientUser.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes an audit entry", async () => {
    const db = testDb();
    const actor = await superAdmin(db);
    const client = await createOrganization(db, { isClient: true });

    await archiveOrganization(db, actor, client.id);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Organization", entityId: client.id, action: "archive" },
    });
    expect(audit.actorUserId).toBe(actor.userId);
  });
});
