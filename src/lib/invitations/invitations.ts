import { createHash, randomBytes } from "node:crypto";
import type { Invitation, PrismaClient } from "@prisma/client";
import { createLocalAccountIssuer } from "better-auth";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
  type RoleCode,
} from "@/lib/auth/permissions";
import { withAudit, writeAudit } from "@/lib/audit/audit";
import { getSetting } from "@/lib/settings/settings";
import { normalizeEmail } from "@/lib/normalise/email";
import { auth } from "@/lib/auth/better-auth";
import { sendEmail } from "@/lib/email/send";
import { logger } from "@/lib/logging/logger";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A role is only offerable to an organisation carrying the matching capability flag. */
export async function assertRoleFitsOrganization(
  db: PrismaClient,
  organizationId: string,
  roleCode: RoleCode,
): Promise<{ roleId: string }> {
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (role === null) throw new ValidationError(`Unknown role: ${roleCode}`);

  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (org === null || org.deletedAt !== null) throw new NotFoundError("Organisation not found");

  const permitted =
    (role.portal === "admin" && org.isInternal) ||
    (role.portal === "client" && org.isClient) ||
    (role.portal === "partner" && org.isPartner);

  if (!permitted) {
    throw new ValidationError(
      `Organisation ${org.name} cannot hold a ${role.portal} role`,
    );
  }
  return { roleId: role.id };
}

export async function createInvitation(
  db: PrismaClient,
  actor: Actor,
  input: { email: string; organizationId: string; roleCode: RoleCode },
): Promise<{ invitation: Invitation; token: string }> {
  assertPermission(actor, "user:invite");
  assertOrganizationAccess(actor, input.organizationId);

  const org = await db.organization.findUnique({ where: { id: input.organizationId } });
  if (!org || org.status === "archived") {
    throw new Error("Cannot invite users to an archived organisation");
  }

  const email = normalizeEmail(input.email);
  const { roleId } = await assertRoleFitsOrganization(db, input.organizationId, input.roleCode);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing !== null) {
    // AUTH-6: one user, one organisation. A second organisation needs a second address.
    throw new ConflictError(`${email} already has an account`);
  }

  const pending = await db.invitation.findFirst({ where: { email, status: "pending" } });
  if (pending !== null) throw new ConflictError(`${email} already has a pending invitation`);

  const expiryDays = await getSetting(db, "invitationExpiryDays");
  const token = newToken();

  const invitation = await withAudit<Invitation>(
    db,
    actor,
    (created) => ({
      entityType: "Invitation",
      entityId: created.id,
      action: "create",
      after: { email, organizationId: input.organizationId, roleCode: input.roleCode },
    }),
    (tx) =>
      tx.invitation.create({
        data: {
          email,
          organizationId: input.organizationId,
          roleId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
          invitedById: actor.userId,
          status: "pending",
        },
      }),
  );

  // The send happens after the audited transaction has committed, so a
  // delivery failure must not fail the call: the invitation row and its token
  // already exist, a second createInvitation for the same address throws
  // ConflictError, and the raw token is deliberately never surfaced to the UI
  // — throwing here would leave the operator with an invitation they can
  // neither deliver nor recreate. resendInvitation is the retry path, and it
  // rotates the token (AUTH-5) so nothing is lost by using it.
  try {
    await sendEmail({
      to: email,
      subject: "You have been invited",
      body: `Accept your invitation: ${process.env.APP_BASE_URL}/invite/${token}`,
    });
  } catch (error) {
    logger.error("invitation.email.failed", {
      invitationId: invitation.id,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { invitation, token };
}

export async function resendInvitation(
  db: PrismaClient,
  actor: Actor,
  invitationId: string,
): Promise<{ invitation: Invitation; token: string }> {
  assertPermission(actor, "user:invite");

  const existing = await db.invitation.findUnique({ where: { id: invitationId } });
  if (existing === null) throw new NotFoundError("Invitation not found");
  assertOrganizationAccess(actor, existing.organizationId);
  if (existing.status !== "pending") {
    throw new ValidationError(`Cannot resend a ${existing.status} invitation`);
  }

  const expiryDays = await getSetting(db, "invitationExpiryDays");
  const token = newToken();

  // AUTH-5: a resend issues a new token and invalidates the old one, which is
  // what replacing tokenHash accomplishes.
  //
  // The audit entry carries before/after like revokeInvitation's does — this
  // rotates a credential, so the trail has to show that it changed (NFR-A-1).
  // Only the expiry and the fact that the hash changed are recorded: neither
  // the raw token nor its hash belongs in a queryable audit row.
  const invitation = await withAudit<Invitation>(
    db,
    actor,
    (updated) => ({
      entityType: "Invitation",
      entityId: invitationId,
      action: "resend",
      before: { tokenRotated: false, expiresAt: existing.expiresAt.toISOString() },
      after: { tokenRotated: true, expiresAt: updated.expiresAt.toISOString() },
    }),
    async (tx) => {
      // Re-check status inside the transaction so two concurrent resends
      // cannot both rotate the token off the same pending invitation.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitationId, status: "pending" },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
        },
      });
      if (claimed.count === 0) throw new ValidationError("Invitation is no longer pending");

      return tx.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    },
  );

  await sendEmail({
    to: invitation.email,
    subject: "Your invitation, resent",
    body: `Accept your invitation: ${process.env.APP_BASE_URL}/invite/${token}`,
  });

  return { invitation, token };
}

export async function revokeInvitation(
  db: PrismaClient,
  actor: Actor,
  invitationId: string,
): Promise<void> {
  assertPermission(actor, "user:invite");

  const existing = await db.invitation.findUnique({ where: { id: invitationId } });
  if (existing === null) throw new NotFoundError("Invitation not found");
  assertOrganizationAccess(actor, existing.organizationId);
  if (existing.status !== "pending") {
    throw new ValidationError(`Cannot revoke a ${existing.status} invitation`);
  }

  await withAudit(
    db,
    actor,
    { entityType: "Invitation", entityId: invitationId, action: "revoke" },
    async (tx) => {
      await tx.invitation.update({
        where: { id: invitationId },
        data: { status: "revoked", revokedAt: new Date() },
      });
    },
  );
}

/**
 * Unauthenticated by design — the token is the credential. AUTH-4: the email
 * on the invitation cannot be changed at acceptance.
 *
 * The Better Auth credential is created via `auth.$context`'s
 * `internalAdapter.createUser` + `linkAccount`, not `auth.api.signUpEmail`.
 * `signUpEmail` is the public-registration endpoint gated by
 * `emailAndPassword.disableSignUp` (AUTH-1, `src/lib/auth/better-auth.ts`);
 * calling it here would throw in every real run. `internalAdapter` is the
 * same primitive Better Auth's own `/sign-up/email` route handler uses
 * internally to create the row (see `better-auth/dist/api/routes/sign-up.mjs`)
 * — it carries no awareness of `disableSignUp`, which is enforced by a single
 * `if` at the top of that route handler and nowhere else.
 */
export async function acceptInvitation(
  db: PrismaClient,
  input: { token: string; name: string; password: string },
): Promise<{ userId: string; email: string }> {
  const tokenHash = hashToken(input.token);

  const user = await db.$transaction(async (tx) => {
    // The lookup, status and expiry checks live inside this transaction so
    // that concurrent acceptances of the same token cannot both pass the
    // "still pending" gate before either commits. The `updateMany` below is
    // the actual atomicity guard: only one concurrent transaction can flip
    // status from "pending" to "accepted" (Postgres serialises the two
    // UPDATEs on the row and re-checks the WHERE clause for the second one
    // once the first commits), so the loser sees `count === 0` and gets the
    // same typed `ValidationError` as any other invalid invitation instead
    // of an untyped unique-constraint failure from `tx.user.create`.
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      include: { role: true },
    });

    if (invitation === null) throw new ValidationError("Invalid invitation token");
    if (invitation.status !== "pending") throw new ValidationError("Invitation is no longer valid");
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await tx.invitation.updateMany({
        where: { id: invitation.id, status: "pending" },
        data: { status: "expired" },
      });
      throw new ValidationError("Invitation has expired");
    }

    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "accepted", acceptedAt: new Date() },
    });
    if (claimed.count === 0) throw new ValidationError("Invitation is no longer valid");

    const authContext = await auth.$context;

    // `internalAdapter.createUser`/`linkAccount` are the low-level primitives
    // `auth.api.signUpEmail`'s route handler builds on
    // (`better-auth/dist/api/routes/sign-up.mjs`) — but that handler's
    // `minPasswordLength`/`maxPasswordLength` check is a plain `if` in the
    // route itself, not in `internalAdapter`, so calling the primitives
    // directly (see the function doc comment above) skips it entirely.
    // Re-enforcing it here reads the *same* `password.config` object the
    // route handler reads (`ctx.context.password.config`), which Better Auth
    // resolves once from `emailAndPassword.minPasswordLength`/
    // `maxPasswordLength` (defaulting to 8/128 — see
    // `better-auth/dist/context/create-context.mjs`) — so this bound cannot
    // silently drift from whatever `signUpEmail` would have enforced, even if
    // `src/lib/auth/better-auth.ts` starts setting those options explicitly.
    const { minPasswordLength, maxPasswordLength } = authContext.password.config;
    if (input.password.length < minPasswordLength) {
      throw new ValidationError(
        `Password must be at least ${minPasswordLength} characters`,
      );
    }
    if (input.password.length > maxPasswordLength) {
      throw new ValidationError(
        `Password must be at most ${maxPasswordLength} characters`,
      );
    }

    const passwordHash = await authContext.password.hash(input.password);
    // AUTH-4: the invitation token was delivered to this exact mailbox and the
    // token itself is the credential (AUTH-3), so successfully claiming it is
    // proof of control over the address — the same reasoning every
    // invitation-based system uses. Leaving `emailVerified: false` would make
    // the account unusable: `emailAndPassword.requireEmailVerification: true`
    // (src/lib/auth/better-auth.ts) blocks sign-in unconditionally until the
    // flag is set, and nothing in this phase ever sends a verification email.
    // This does not weaken AUTH-1 — there is still no public registration, and
    // this line is only reachable from a real, unexpired, unclaimed invitation.
    const authUser = await authContext.internalAdapter.createUser(
      { email: invitation.email, name: input.name, emailVerified: true },
      { method: "email-password" },
    );
    await authContext.internalAdapter.linkAccount({
      userId: authUser.id,
      providerId: "credential",
      issuer: createLocalAccountIssuer("credential"),
      accountId: authUser.id,
      password: passwordHash,
    });

    const created = await tx.user.create({
      data: {
        email: invitation.email,
        name: input.name,
        organizationId: invitation.organizationId,
        status: "active",
        authUserId: authUser.id,
        roles: { create: { roleId: invitation.roleId } },
      },
    });

    await writeAudit(
      tx,
      {
        userId: created.id,
        organizationId: invitation.organizationId,
        portal: invitation.role.portal,
        roles: [invitation.role.code as RoleCode],
        isClient: false,
        isPartner: false,
        isInternal: false,
      },
      {
        entityType: "Invitation",
        entityId: invitation.id,
        action: "accept",
        after: { userId: created.id },
      },
    );

    return created;
  });

  // The email is returned so the caller can sign the new user in with the
  // credential it just created, using the address the invitation carried
  // rather than anything the browser supplied (AUTH-4).
  return { userId: user.id, email: user.email };
}
