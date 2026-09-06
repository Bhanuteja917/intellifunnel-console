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
  | "asset:write"
  | "allocation:read"
  | "allocation:write"
  | "delivery:read"
  | "delivery:write";

const CLIENT_READ: Permission[] = ["campaign:read", "account:read", "list:read", "organization:read"];

const MATRIX: Readonly<Record<RoleCode, readonly Permission[]>> = {
  SUPER_ADMIN: [], // handled by the explicit check below
  CAMPAIGN_MANAGER: [
    "organization:read", "account:read", "account:write", "channelType:read",
    "campaign:read", "campaign:write", "campaign:submitInternal",
    "campaign:approveInternal", "campaign:clone",
    "list:read", "list:write", "audit:read",
    "asset:read", "asset:write", "delivery:read",
  ],
  OPERATIONS: [
    "organization:read", "account:read", "account:write", "channelType:read",
    "campaign:read", "list:read", "list:write",
    "asset:read", "asset:write", "allocation:read", "allocation:write",
    "delivery:read", "delivery:write",
  ],
  QUALITY: ["organization:read", "account:read", "campaign:read", "channelType:read", "lead:read", "lead:write"],
  ACCOUNT_MANAGER: [
    "organization:read", "organization:write", "user:invite",
    "account:read", "campaign:read", "list:read", "channelType:read",
  ],
  FINANCE: ["organization:read", "campaign:read", "exchangeRate:write", "audit:read"],
  CLIENT_ADMIN: [...CLIENT_READ, "campaign:approveClient", "user:invite", "list:write"],
  CLIENT_VIEWER: [...CLIENT_READ],
  PARTNER_ADMIN: ["organization:read", "campaign:read", "user:invite", "allocation:read"],
  PARTNER_OPERATOR: ["organization:read", "campaign:read", "allocation:read"],
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

/**
 * Org-scope where-clause for a query reached *through* a CampaignChannel
 * (Lead, LeadSubmission, ...). `{}` for an internal actor; otherwise
 * `{ campaign: { clientOrganizationId } }`, meant to be merged into (or
 * nested one level under a `campaignChannel:` key of) the caller's own
 * where-clause — never spread alongside another top-level write to the same
 * key (see verification/page.tsx's own comment on why that silently drops
 * the scope).
 */
export function campaignChannelOrgScopeClause(
  actor: Actor,
): Record<string, never> | { campaign: { clientOrganizationId: string } } {
  return actor.isInternal ? {} : { campaign: { clientOrganizationId: actor.organizationId } };
}

/** Org-scope where-clause for a direct Campaign query. `{}` for an internal actor. */
export function campaignOrgScopeClause(
  actor: Actor,
): Record<string, never> | { clientOrganizationId: string } {
  return actor.isInternal ? {} : { clientOrganizationId: actor.organizationId };
}

/**
 * Guards a portal-specific route segment. Next.js's `error.js` convention
 * never wraps the `layout.js` beside it in the same segment — only what's
 * below it — so a throw from this check inside a `layout.tsx` is only ever
 * caught by the *parent* segment's error boundary, not the portal's own.
 * Worse, an uncaught throw here doesn't just go to the wrong boundary — it
 * wins outright over a page-level call to this same function: `layout.tsx`
 * and `page.tsx` run concurrently for one request, and empirically (checked
 * against both `next dev` and a production build) the layout's own throw is
 * the one that reaches the browser, silently discarding whatever the page
 * independently threw. A layout that calls this must therefore catch it and
 * fall through to rendering `{children}` rather than letting it propagate —
 * see `src/app/partner/layout.tsx`. Call this again, uncaught, as the first
 * line of every page inside that portal (before any data fetch) — see
 * `src/app/partner/allocations/page.tsx` — so the throw originates inside a
 * segment the portal's own `error.tsx` does wrap, and isn't racing a layout
 * that also throws.
 */
export function assertPortal(actor: Actor, portal: Portal): void {
  if (actor.portal !== portal) {
    throw new ForbiddenError(`This portal is for ${portal} users`);
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
