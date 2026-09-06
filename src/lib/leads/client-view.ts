import type { PrismaClient } from "@prisma/client";
import {
  assertOrganizationAccess,
  assertPermission,
  campaignChannelOrgScopeClause,
  type Actor,
} from "@/lib/auth/permissions";

export type ClientLeadView = {
  id: string;
  accountName: string;
  contactEmail: string;
  contactName: string | null;
  campaignName: string;
  channelTypeName: string;
  fieldValues: Record<string, string>;
  acceptedAt: Date;
  deliveryStatus: "pending" | "success" | "failed";
};

/**
 * AUTH-10: a distinct read model, not admin-response field-filtering. The
 * `where` below never matches a row outside the actor's own organisation or
 * with clientVisible: false — rejected leads, internal verification notes,
 * partner identity, and payout fields are structurally absent from the
 * query, not merely omitted from the output type. `deliveryStatus` is a
 * derived projection of the lead's most recent DeliveryRun (via
 * DeliveryRunLead), independent of clientVisible — see the E11 design spec's
 * scope decision 3.
 *
 * Org scoping is delegated to `campaignChannelOrgScopeClause`, the shared
 * helper other campaignChannel-scoped queries in this codebase already use.
 * Like every other caller of that helper (and unlike `partner-view.ts`,
 * which deliberately does not use it), this means an `isInternal` actor gets
 * `{}` here — no org filter at all. That bypass is only safe because nothing
 * that reaches this function is exposed to an internal actor in practice:
 * the client portal route that calls this (Task 12) gates on `assertPortal`
 * first, and internal staff hold no client-portal role. This function does
 * not itself re-verify that; it only re-checks (via
 * `assertOrganizationAccess` below) that the query's own scoping held.
 */
export async function getLeadsForClient(
  db: PrismaClient,
  actor: Actor,
  filter: { limit?: number; cursor?: string },
): Promise<{ leads: ClientLeadView[]; nextCursor: string | null }> {
  assertPermission(actor, "campaign:read");

  const limit = filter.limit ?? 50;
  const rows = await db.lead.findMany({
    where: {
      clientVisible: true,
      campaignChannel: campaignChannelOrgScopeClause(actor),
    },
    include: {
      account: { select: { name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
      campaignChannel: {
        select: {
          channelTypeVersion: { select: { definitionJson: true } },
          campaign: { select: { name: true, clientOrganizationId: true } },
        },
      },
      deliveryRunLeads: {
        include: { deliveryRun: { select: { status: true, completedAt: true, createdAt: true } } },
        orderBy: { deliveryRun: { createdAt: "desc" } },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(filter.cursor === undefined ? {} : { cursor: { id: filter.cursor }, skip: 1 }),
  });

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;

  return {
    leads: page.map((row) => {
      // Defence in depth: assertOrganizationAccess re-checks what the where-clause
      // above already enforced, so a future refactor that loosens the query can't
      // silently leak another organisation's lead past this function.
      assertOrganizationAccess(actor, row.campaignChannel.campaign.clientOrganizationId);
      const latestRun = row.deliveryRunLeads[0]?.deliveryRun;
      const deliveryStatus: ClientLeadView["deliveryStatus"] =
        latestRun === undefined
          ? "pending"
          : latestRun.status === "success"
            ? "success"
            : latestRun.status === "failed" || latestRun.status === "exhausted"
              ? "failed"
              : "pending";
      const def = row.campaignChannel.channelTypeVersion.definitionJson as { name?: string };
      return {
        id: row.id,
        accountName: row.account.name,
        contactEmail: row.contact.email,
        contactName: [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ") || null,
        campaignName: row.campaignChannel.campaign.name,
        channelTypeName: def.name ?? "Unknown channel",
        fieldValues: (row.fieldValuesJson as Record<string, string> | null) ?? {},
        acceptedAt: row.acceptedAt!,
        deliveryStatus,
      };
    }),
    nextCursor,
  };
}
