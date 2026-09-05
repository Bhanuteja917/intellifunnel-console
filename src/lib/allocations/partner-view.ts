import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

export type PartnerAllocationView = {
  id: string;
  channelTypeName: string;
  funnelStageCode: string;
  allocatedQuantity: number;
  payoutRateMinor: bigint;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
};

/**
 * AUTH-10: a distinct read model, not field-filtering applied to the admin
 * response. The `select` below never reaches `campaignChannel.campaign` at
 * all — client name, other partners' allocations, and campaign pricing are
 * structurally absent from the query result, not merely omitted from the
 * output type. Scoped unconditionally to the actor's own organisation — no
 * `isInternal` bypass, unlike every admin-side org-scoping query in this
 * codebase. An org that is both internal and a partner would see its own
 * allocations; this function has no special-case bypass for `isInternal`. In
 * practice an internal actor's org is never also a partner org, so this
 * returns empty for them, but that is a consequence of the data, not a
 * guarantee this function enforces.
 */
export async function getAllocationsForPartner(
  db: PrismaClient,
  actor: Actor,
): Promise<PartnerAllocationView[]> {
  assertPermission(actor, "allocation:read");
  const rows = await db.partnerAllocation.findMany({
    where: { partnerOrganizationId: actor.organizationId, status: "active" },
    select: {
      id: true, allocatedQuantity: true, payoutRateMinor: true, payoutCurrency: true,
      startDate: true, endDate: true,
      campaignChannel: { select: { channelTypeVersion: { select: { definitionJson: true } } } },
    },
  });
  return rows.map((r) => {
    const def = r.campaignChannel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
    return {
      id: r.id, channelTypeName: def.name, funnelStageCode: def.funnelStageCode,
      allocatedQuantity: r.allocatedQuantity, payoutRateMinor: r.payoutRateMinor,
      payoutCurrency: r.payoutCurrency, startDate: r.startDate, endDate: r.endDate,
    };
  });
}
