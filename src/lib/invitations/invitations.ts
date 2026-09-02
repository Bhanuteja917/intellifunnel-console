import { createHash, randomBytes } from "node:crypto";
import type { Invitation, PrismaClient } from "@prisma/client";
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

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A role is only offerable to an organisation carrying the matching capability flag. */
async function assertRoleFitsOrganization(
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

  await sendEmail({
    to: email,
    subject: "You have been invited",
    body: `Accept your invitation: ${process.env.APP_BASE_URL}/invite/${token}`,
  });

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
  const invitation = await withAudit<Invitation>(
    db,
    actor,
    { entityType: "Invitation", entityId: invitationId, action: "resend" },
    (tx) =>
      tx.invitation.update({
        where: { id: invitationId },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
        },
      }),
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
 */
export async function acceptInvitation(
  db: PrismaClient,
  input: { token: string; name: string; password: string },
): Promise<{ userId: string }> {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { role: true },
  });

  if (invitation === null) throw new ValidationError("Invalid invitation token");
  if (invitation.status !== "pending") throw new ValidationError("Invitation is no longer valid");
  if (invitation.expiresAt.getTime() <= Date.now()) {
    await db.invitation.update({ where: { id: invitation.id }, data: { status: "expired" } });
    throw new ValidationError("Invitation has expired");
  }

  const signUp = await auth.api.signUpEmail({
    body: { email: invitation.email, password: input.password, name: input.name },
  });

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invitation.email,
        name: input.name,
        organizationId: invitation.organizationId,
        status: "active",
        authUserId: signUp.user.id,
        roles: { create: { roleId: invitation.roleId } },
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedAt: new Date() },
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

  return { userId: user.id };
}
