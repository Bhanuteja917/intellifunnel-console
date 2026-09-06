import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Atomically claims one unit of capacity. Raw SQL, not a Prisma `updateMany`
 * `where`, because the guard compares two summed columns against a third —
 * Prisma's filter API can only compare a column to a literal/variable, not
 * to another column. Returns whether the claim succeeded (affected-row
 * count > 0), so the caller can fall back to a cap-reached outcome instead.
 */
export async function claimChannelSlot(tx: Tx, campaignChannelId: string, wantsDelivered: boolean): Promise<boolean> {
  const claimed = wantsDelivered
    ? await tx.$executeRaw`UPDATE "CampaignChannel" SET "deliveredCount" = "deliveredCount" + 1 WHERE id = ${campaignChannelId} AND "reservedCount" + "deliveredCount" < "contractedQuantity"`
    : await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" + 1 WHERE id = ${campaignChannelId} AND "reservedCount" + "deliveredCount" < "contractedQuantity"`;
  return claimed > 0;
}

export async function releaseChannelSlot(tx: Tx, campaignChannelId: string, wasDelivered: boolean): Promise<void> {
  if (wasDelivered) {
    await tx.$executeRaw`UPDATE "CampaignChannel" SET "deliveredCount" = "deliveredCount" - 1 WHERE id = ${campaignChannelId}`;
  } else {
    await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" - 1 WHERE id = ${campaignChannelId}`;
  }
}

export async function convertChannelReservedToDelivered(tx: Tx, campaignChannelId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" - 1, "deliveredCount" = "deliveredCount" + 1 WHERE id = ${campaignChannelId}`;
}

export async function claimAllocationSlot(tx: Tx, allocationId: string, wantsDelivered: boolean): Promise<boolean> {
  const claimed = wantsDelivered
    ? await tx.$executeRaw`UPDATE "PartnerAllocation" SET "deliveredCount" = "deliveredCount" + 1 WHERE id = ${allocationId} AND "reservedCount" + "deliveredCount" < "allocatedQuantity"`
    : await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" + 1 WHERE id = ${allocationId} AND "reservedCount" + "deliveredCount" < "allocatedQuantity"`;
  return claimed > 0;
}

export async function releaseAllocationSlot(tx: Tx, allocationId: string, wasDelivered: boolean): Promise<void> {
  if (wasDelivered) {
    await tx.$executeRaw`UPDATE "PartnerAllocation" SET "deliveredCount" = "deliveredCount" - 1 WHERE id = ${allocationId}`;
  } else {
    await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" - 1 WHERE id = ${allocationId}`;
  }
}

export async function convertAllocationReservedToDelivered(tx: Tx, allocationId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" - 1, "deliveredCount" = "deliveredCount" + 1 WHERE id = ${allocationId}`;
}
