import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, paceSignal, type PaceSignal } from "@/lib/allocations/pacing";

export type PartnerAllocationView = {
  id: string;
  channelTypeName: string;
  funnelStageCode: string;
  allocatedQuantity: number;
  deliveredCount: number;
  // Capacity is enforced on `reservedCount + deliveredCount < cap`, so a
  // partner who can only see `deliveredCount` cannot tell how much of their
  // cap is actually left — they'd read 3/10 as seven slots free and then be
  // rejected with ALLOCATION_CAP_EXCEEDED with no visible explanation.
  reservedCount: number;
  pace: PaceSignal;
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
  const timeZone = await getSetting(db, "operatingTimezone");
  const rows = await db.partnerAllocation.findMany({
    where: { partnerOrganizationId: actor.organizationId, status: "active" },
    select: {
      id: true, allocatedQuantity: true, deliveredCount: true, reservedCount: true,
      payoutRateMinor: true, payoutCurrency: true,
      startDate: true, endDate: true,
      campaignChannel: { select: { channelTypeVersion: { select: { definitionJson: true } } } },
    },
  });
  const now = new Date();
  return rows.map((r) => {
    const def = r.campaignChannel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
    const expected = expectedToDate(r.allocatedQuantity, r.startDate, r.endDate, now, timeZone);
    return {
      id: r.id, channelTypeName: def.name, funnelStageCode: def.funnelStageCode,
      allocatedQuantity: r.allocatedQuantity, deliveredCount: r.deliveredCount,
      reservedCount: r.reservedCount,
      pace: paceSignal(r.deliveredCount, expected),
      payoutRateMinor: r.payoutRateMinor,
      payoutCurrency: r.payoutCurrency, startDate: r.startDate, endDate: r.endDate,
    };
  });
}
