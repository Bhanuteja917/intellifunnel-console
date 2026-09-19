import type { PrismaClient, User, UserStatus } from "@prisma/client";
import { withAudit } from "@/lib/audit/audit";
import { assertPermission, type Actor, type RoleCode } from "@/lib/auth/permissions";
import { assertRoleFitsOrganization } from "@/lib/invitations/invitations";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type UpdateUserInput = {
  name?: string;
  status?: UserStatus;
  roleCodes?: RoleCode[];
};

export async function updateUser(
  db: PrismaClient,
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
): Promise<User> {
  assertPermission(actor, "user:manageRoles");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (user === null || user.deletedAt !== null) throw new NotFoundError("User not found");

  if (input.name !== undefined && input.name.trim() === "") {
    throw new ValidationError("Name cannot be empty");
  }

  if (input.roleCodes !== undefined) {
    for (const roleCode of input.roleCodes) {
      await assertRoleFitsOrganization(db, user.organizationId, roleCode);
    }
  }

  return withAudit<User>(
    db,
    actor,
    { entityType: "User", entityId: userId, action: "update" },
    async (tx) => {
      if (input.roleCodes !== undefined) {
        const roles = await tx.role.findMany({ where: { code: { in: input.roleCodes } } });
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId, roleId: role.id })),
        });
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          status: input.status,
          updatedById: actor.userId,
        },
      });
    },
  );
}

export async function deleteUser(db: PrismaClient, actor: Actor, userId: string): Promise<User> {
  assertPermission(actor, "user:manageRoles");

  if (userId === actor.userId) {
    throw new ValidationError("You cannot delete your own account");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (user === null || user.deletedAt !== null) throw new NotFoundError("User not found");

  return withAudit<User>(
    db,
    actor,
    { entityType: "User", entityId: userId, action: "delete" },
    async (tx) => {
      // Mangle the email so it frees up for re-invitation: the row stays
      // (deletedAt) for audit history, but its @unique email would otherwise
      // permanently block inviting that address again.
      const deleted = await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          updatedById: actor.userId,
          email: `deleted+${Date.now()}+${user.email}`,
          authUserId: null,
        },
      });

      // Kill the Better Auth credential (and, by cascade, its sessions and
      // linked accounts) so the deleted user can neither log in nor block a
      // re-invitation's AuthUser.email @unique constraint.
      if (user.authUserId !== null) {
        await tx.authUser.delete({ where: { id: user.authUserId } });
      }

      return deleted;
    },
  );
}
