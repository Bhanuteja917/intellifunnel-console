import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { ForbiddenError } from "@/lib/errors";

const getSession = vi.fn();
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { getSession: () => getSession() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Deliberately no vi.resetModules() here: it would force a fresh module
// instance of the non-mocked @/lib/errors on every dynamic import() below,
// so the ForbiddenError thrown from inside the freshly re-imported
// @/lib/auth/session would no longer be `instanceof` the class this file
// imported statically above — breaking every rejects.toBeInstanceOf check.
// getSession.mockReset() below is sufficient to isolate tests.

describe("getCurrentActor", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    getSession.mockReset();
  });

  it("resolves the actor from the session's auth user id", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    await db.user.update({ where: { id: user.id }, data: { authUserId: "auth-1" } });
    getSession.mockResolvedValue({ user: { id: "auth-1" } });

    const { getCurrentActor } = await import("@/lib/auth/session");
    const actor = await getCurrentActor(db);

    expect(actor.userId).toBe(user.id);
    expect(actor.roles).toEqual(["CAMPAIGN_MANAGER"]);
  });

  it("throws when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const { getCurrentActor } = await import("@/lib/auth/session");
    await expect(getCurrentActor(testDb())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws when the session user has no application record", async () => {
    getSession.mockResolvedValue({ user: { id: "auth-unknown" } });
    const { getCurrentActor } = await import("@/lib/auth/session");
    await expect(getCurrentActor(testDb())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
