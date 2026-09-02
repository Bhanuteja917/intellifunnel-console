import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { acceptInvitation, createInvitation } from "@/lib/invitations/invitations";
import { ValidationError } from "@/lib/errors";
import { auth } from "@/lib/auth/better-auth";
import { verifyPassword } from "better-auth/crypto";

/**
 * Unlike tests/invitations.test.ts, this file does NOT mock
 * `@/lib/auth/better-auth`. It drives `acceptInvitation` against the real
 * Better Auth instance and the real (testcontainers) Postgres database, to
 * prove two things the mocked suite structurally cannot:
 *
 * 1. `acceptInvitation` does not rely on `auth.api.signUpEmail` — which
 *    `emailAndPassword.disableSignUp: true` (AUTH-1) blocks unconditionally,
 *    for every caller, including server-side ones — and instead creates a
 *    real AuthUser + AuthAccount row via `auth.$context`'s internal adapter.
 * 2. The invitation-claim race fix actually serialises concurrent accepts
 *    against a real database, not a mocked one.
 */
async function internalActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("acceptInvitation against the real Better Auth instance", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedSettings(testDb());
  });

  it("confirms disableSignUp still blocks the public signUpEmail endpoint (AUTH-1 sanity check)", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "nope@example.com", password: "correct horse battery staple", name: "Nope" },
      }),
    ).rejects.toThrow();

    const db = testDb();
    expect(await db.authUser.findUnique({ where: { email: "nope@example.com" } })).toBeNull();
  });

  it("creates a real AuthUser + AuthAccount credential row without going through signUpEmail", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "jane@acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    const { userId } = await acceptInvitation(db, {
      token,
      name: "Jane Doe",
      password: "correct horse battery staple",
    });

    const appUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(appUser.authUserId).not.toBeNull();

    const authUser = await db.authUser.findUniqueOrThrow({
      where: { id: appUser.authUserId! },
    });
    expect(authUser.email).toBe("jane@acme.com");

    const authAccount = await db.authAccount.findFirstOrThrow({
      where: { userId: authUser.id, providerId: "credential" },
    });
    expect(authAccount.password).toBeTruthy();
    expect(authAccount.password).not.toBe("correct horse battery staple");

    // The credential is a real, verifiable Better Auth password hash — not
    // just an opaque string. (A live `auth.api.signInEmail` call is a
    // separate check: `requireEmailVerification: true` blocks sign-in until
    // the user verifies their email, which is orthogonal to whether the
    // credential itself was created correctly.)
    const verified = await verifyPassword({
      hash: authAccount.password!,
      password: "correct horse battery staple",
    });
    expect(verified).toBe(true);
  });

  it("rejects a password shorter than Better Auth's real minPasswordLength default (8)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "short@acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    // `src/lib/auth/better-auth.ts` does not set `emailAndPassword.min
    // PasswordLength`, so this exercises Better Auth's real default (8,
    // from `better-auth/dist/context/create-context.mjs`) rather than a
    // value this test suite made up.
    await expect(
      acceptInvitation(db, { token, name: "Short", password: "short1" }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.authUser.findUnique({ where: { email: "short@acme.com" } })).toBeNull();
  });

  it("lets exactly one of two concurrent accepts win, with no orphaned AuthUser row", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "race@acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    const results = await Promise.allSettled([
      acceptInvitation(db, { token, name: "Race A", password: "correct horse battery staple" }),
      acceptInvitation(db, { token, name: "Race B", password: "correct horse battery staple" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);

    const appUsers = await db.user.findMany({ where: { email: "race@acme.com" } });
    expect(appUsers).toHaveLength(1);

    const authUsers = await db.authUser.findMany({ where: { email: "race@acme.com" } });
    expect(authUsers).toHaveLength(1);
  });
});
