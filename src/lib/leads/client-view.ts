import type { PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";

export type ClientLeadView = {
  id: string;
  accountName: string;
  contactEmail: string;
  contactName: string | null;
  campaignName: string;
  channelTypeName: string;
  fieldValues: Record<string, string>;
  acceptedAt: Date;
  deliveryStatus: "pending" | "success" | "failed" | "notConfigured";
};

/**
 * AUTH-10: a distinct read model, not admin-response field-filtering. The
 * `where` below never matches a row outside the actor's own organisation or
 * with clientVisible: false — rejected leads, internal verification notes,
 * partner identity, and payout fields are structurally absent from the
 * query, not merely omitted from the output type. `deliveryStatus` is a
 * derived projection of the lead's most recent DeliveryRun (via
 * DeliveryRunLead), independent of clientVisible — see the E11 design spec's
 * scope decision 3. When no DeliveryRun exists yet, `deliveryStatus` falls
 * back to `"pending"` only if the channel actually has an active
 * DeliveryConfig — one will eventually run and pick this lead up. If the
 * channel has no DeliveryConfig at all (or a paused one), no run will EVER be
 * created for this lead, so `"pending"` would be misleading forever; it
 * reports `"notConfigured"` instead.
 *
 * Org scoping is unconditional — `clientOrganizationId: actor.organizationId`
 * always applies, with no `isInternal` bypass — matching the convention
 * `partner-view.ts` documents for a client/partner-facing read model.
 * `assertOrganizationAccess`'s own doc comment names this function (an
 * AUTH-10 read model) as the layer responsible for constraining what an
 * internal actor sees, since that helper itself returns immediately for
 * `isInternal` actors. So this function must not rely on the shared
 * `campaignChannelOrgScopeClause` helper (which resolves to `{}` — no filter
 * at all — for an internal actor): doing so, however briefly, was flagged as
 * a critical cross-organisation exposure and reverted.
 */
export async function getLeadsForClient(
  db: PrismaClient,
  actor: Actor,
  filter: { limit?: number; cursor?: string; campaignId?: string },
): Promise<{ leads: ClientLeadView[]; nextCursor: string | null }> {
  assertPermission(actor, "campaign:read");

  const limit = filter.limit ?? 50;
  const rows = await db.lead.findMany({
    where: {
      clientVisible: true,
      campaignChannel: {
        campaign: {
          // The unconditional org scope stays exactly where it is; the
          // optional campaign filter is a sibling key, never spread over it.
          clientOrganizationId: actor.organizationId,
          ...(filter.campaignId === undefined ? {} : { id: filter.campaignId }),
        },
      },
    },
    include: {
      account: { select: { name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
      campaignChannel: {
        select: {
          channelTypeVersion: { select: { definitionJson: true } },
          campaign: { select: { name: true, clientOrganizationId: true } },
          deliveryConfig: { select: { status: true } },
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
      const configIsActive = row.campaignChannel.deliveryConfig?.status === "active";
      const deliveryStatus: ClientLeadView["deliveryStatus"] =
        latestRun !== undefined
          ? latestRun.status === "success"
            ? "success"
            : latestRun.status === "failed" || latestRun.status === "exhausted"
              ? "failed"
              : "pending"
          : configIsActive
            ? "pending"
            : "notConfigured";
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
