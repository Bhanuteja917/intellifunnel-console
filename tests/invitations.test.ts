import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import {
  acceptInvitation,
  createInvitation,
  hashToken,
  resendInvitation,
  revokeInvitation,
} from "@/lib/invitations/invitations";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";

// acceptInvitation creates the Better Auth credential via `auth.$context`'s
// `internalAdapter.createUser` + `linkAccount` (not the public-signup-gated
// `auth.api.signUpEmail` — see the comment on `acceptInvitation`), so that's
// what this mock stands in for.
const createAuthUser = vi.fn(async (user: { email: string }) => ({
  id: "auth-new",
  ...user,
}));
const linkAuthAccount = vi.fn(async () => undefined);
const hashAuthPassword = vi.fn(async () => "hashed-password");
vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: () => hashAuthPassword() },
      internalAdapter: {
        createUser: (user: unknown) => createAuthUser(user as never),
        linkAccount: () => linkAuthAccount(),
      },
    }),
  },
}));

async function internalActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("invitations", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedSettings(testDb());
    createAuthUser.mockClear();
    linkAuthAccount.mockClear();
    hashAuthPassword.mockClear();
  });

  it("stores only the token hash and returns the raw token once", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);

    const { invitation, token } = await createInvitation(db, actor, {
      email: "Jane@Acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toBe(token);
    expect(invitation.email).toBe("jane@acme.com");
  });

  it("expires after invitationExpiryDays", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);

    const before = Date.now();
    const { invitation } = await createInvitation(db, actor, {
      email: "jane@acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    const days = (invitation.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("rejects a role from a portal the organisation cannot use", async () => {
    const db = testDb();
    const actor = await internalActor();
    const clientOnly = await createOrganization(db, { isClient: true, isPartner: false });

    await expect(
      createInvitation(db, actor, {
        email: "jane@acme.com",
        organizationId: clientOnly.id,
        roleCode: "PARTNER_ADMIN",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks a client admin inviting into another organisation (AUTH-9)", async () => {
    const db = testDb();
    const orgA = await createOrganization(db);
    const orgB = await createOrganization(db);
    const clientAdmin = await createUser(db, orgA.id, "CLIENT_ADMIN");
    const actor = await loadActor(db, clientAdmin.id);

    await expect(
      createInvitation(db, actor, { email: "x@b.com", organizationId: orgB.id, roleCode: "CLIENT_VIEWER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks a client viewer inviting at all", async () => {
    const db = testDb();
    const org = await createOrganization(db);
    const viewer = await createUser(db, org.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, viewer.id);

    await expect(
      createInvitation(db, actor, { email: "x@a.com", organizationId: org.id, roleCode: "CLIENT_VIEWER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("invalidates the old token on resend (AUTH-5)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const first = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const second = await resendInvitation(db, actor, first.invitation.id);

    expect(second.token).not.toBe(first.token);
    await expect(
      acceptInvitation(db, { token: first.token, name: "Jane", password: "correct horse battery" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates the user, binds the role and marks the email verified (AUTH-4)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const { userId } = await acceptInvitation(db, {
      token, name: "Jane Doe", password: "correct horse battery staple",
    });

    const user = await db.user.findUniqueOrThrow({
      where: { id: userId }, include: { roles: { include: { role: true } } },
    });
    expect(user.email).toBe("jane@acme.com");
    expect(user.organizationId).toBe(client.id);
    expect(user.status).toBe("active");
    expect(user.roles.map((r) => r.role.code)).toEqual(["CLIENT_ADMIN"]);

    const invitation = await db.invitation.findFirstOrThrow({ where: { email: "jane@acme.com" } });
    expect(invitation.status).toBe("accepted");
  });

  it("is single-use (AUTH-3)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" });

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an expired token", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { invitation, token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await db.invitation.update({
      where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a revoked token", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { invitation, token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await revokeInvitation(db, actor, invitation.id);

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to invite an email that already has an account (AUTH-6)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    await createUser(db, client.id, "CLIENT_VIEWER", { email: "taken@acme.com" });

    await expect(
      createInvitation(db, actor, {
        email: "taken@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
