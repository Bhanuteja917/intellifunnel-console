import type { Portal, PrismaClient } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";

export type RoleCode =
  | "SUPER_ADMIN"
  | "CAMPAIGN_MANAGER"
  | "OPERATIONS"
  | "QUALITY"
  | "ACCOUNT_MANAGER"
  | "FINANCE"
  | "CLIENT_ADMIN"
  | "CLIENT_VIEWER"
  | "PARTNER_ADMIN"
  | "PARTNER_OPERATOR";

export type Permission =
  | "organization:read"
  | "organization:write"
  | "user:invite"
  | "user:manageRoles"
  | "account:read"
  | "account:write"
  | "account:merge"
  | "channelType:read"
  | "channelType:write"
  | "channelType:publish"
  | "campaign:read"
  | "campaign:write"
  | "campaign:submitInternal"
  | "campaign:approveInternal"
  | "campaign:approveClient"
  | "campaign:clone"
  | "list:read"
  | "list:write"
  | "exchangeRate:write"
  | "setting:write"
  | "audit:read"
  | "lead:read"
  | "lead:write"
  | "asset:read"
  | "asset:write";

const CLIENT_READ: Permission[] = ["campaign:read", "account:read", "list:read", "organization:read"];

const MATRIX: Readonly<Record<RoleCode, readonly Permission[]>> = {
  SUPER_ADMIN: [], // handled by the explicit check below
  CAMPAIGN_MANAGER: [
    "organization:read", "account:read", "account:write", "channelType:read",
    "campaign:read", "campaign:write", "campaign:submitInternal",
    "campaign:approveInternal", "campaign:clone",
    "list:read", "list:write", "audit:read",
    "asset:read", "asset:write",
  ],
  OPERATIONS: [
    "organization:read", "account:read", "account:write", "channelType:read",
    "campaign:read", "list:read", "list:write",
    "asset:read", "asset:write",
  ],
  QUALITY: ["organization:read", "account:read", "campaign:read", "channelType:read", "lead:read", "lead:write"],
  ACCOUNT_MANAGER: [
    "organization:read", "organization:write", "user:invite",
    "account:read", "campaign:read", "list:read", "channelType:read",
  ],
  FINANCE: ["organization:read", "campaign:read", "exchangeRate:write", "audit:read"],
  CLIENT_ADMIN: [...CLIENT_READ, "campaign:approveClient", "user:invite", "list:write"],
  CLIENT_VIEWER: [...CLIENT_READ],
  PARTNER_ADMIN: ["organization:read", "campaign:read", "user:invite"],
  PARTNER_OPERATOR: ["organization:read", "campaign:read"],
};

export type Actor = {
  userId: string;
  organizationId: string;
  portal: Portal;
  roles: RoleCode[];
  isClient: boolean;
  isPartner: boolean;
  isInternal: boolean;
};

export function hasPermission(actor: Actor, permission: Permission): boolean {
  if (actor.roles.includes("SUPER_ADMIN")) return true;
  return actor.roles.some((role) => MATRIX[role].includes(permission));
}

export function assertPermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

/**
 * AUTH-9: a client or partner actor can never reach another organisation's
 * data. Internal actors are unrestricted at this layer; per-portal read
 * models (AUTH-10, AUTH-11) constrain what they return.
 */
export function assertOrganizationAccess(actor: Actor, organizationId: string): void {
  if (actor.isInternal) return;
  if (actor.organizationId !== organizationId) {
    throw new ForbiddenError("Cross-organisation access denied");
  }
}

export async function loadActor(db: PrismaClient, userId: string): Promise<Actor> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { organization: true, roles: { include: { role: true } } },
  });

  if (user === null || user.deletedAt !== null) throw new ForbiddenError("Unknown user");
  if (user.status !== "active") throw new ForbiddenError("User is not active");
  if (user.organization.status !== "active") throw new ForbiddenError("Organisation is not active");

  const roles = user.roles.map((r) => r.role.code as RoleCode);
  const portal = user.roles[0]?.role.portal;
  if (portal === undefined) throw new ForbiddenError("User has no role");

  return {
    userId: user.id,
    organizationId: user.organizationId,
    portal,
    roles,
    isClient: user.organization.isClient,
    isPartner: user.organization.isPartner,
    isInternal: user.organization.isInternal,
  };
}
