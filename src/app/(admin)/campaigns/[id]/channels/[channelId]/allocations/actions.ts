"use server";

import { revalidatePath } from "next/cache";
import type { AllocationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createAllocation, setAllocationStatus, updateAllocation } from "@/lib/allocations/crud";
import { ValidationError } from "@/lib/errors";

export async function createAllocationAction(input: {
  campaignId: string; // only for revalidatePath — not passed into createAllocation
  campaignChannelId: string;
  partnerOrganizationId: string;
  allocatedQuantity: number;
  payoutRate: string;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    const payoutRate = input.payoutRate.trim();
    const payoutCurrency = input.payoutCurrency.trim();
    if (payoutRate === "") throw new ValidationError("Payout rate is required");
    if (payoutCurrency === "") throw new ValidationError("Payout currency is required");

    const allocation = await createAllocation(db, actor, {
      campaignChannelId: input.campaignChannelId,
      partnerOrganizationId: input.partnerOrganizationId,
      allocatedQuantity: input.allocatedQuantity,
      payoutRate,
      payoutCurrency,
      startDate: input.startDate,
      endDate: input.endDate,
      revealClientIdentity: input.revealClientIdentity,
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    return { id: allocation.id };
  });
}

export async function updateAllocationAction(input: {
  campaignId: string; // only for revalidatePath
  campaignChannelId: string; // only for revalidatePath
  allocationId: string;
  allocatedQuantity: number;
  payoutRate: string;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    const payoutRate = input.payoutRate.trim();
    const payoutCurrency = input.payoutCurrency.trim();
    if (payoutRate === "") throw new ValidationError("Payout rate is required");
    if (payoutCurrency === "") throw new ValidationError("Payout currency is required");

    const allocation = await updateAllocation(db, actor, {
      allocationId: input.allocationId,
      allocatedQuantity: input.allocatedQuantity,
      payoutRate,
      payoutCurrency,
      startDate: input.startDate,
      endDate: input.endDate,
      revealClientIdentity: input.revealClientIdentity,
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(
      `/campaigns/${input.campaignId}/channels/${input.campaignChannelId}/allocations/${input.allocationId}`,
    );
    return { id: allocation.id };
  });
}

export async function setAllocationStatusAction(
  campaignId: string, // only for revalidatePath
  campaignChannelId: string, // only for revalidatePath
  allocationId: string,
  status: AllocationStatus,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setAllocationStatus(db, actor, { allocationId, status });
    revalidatePath(`/campaigns/${campaignId}/channels/${campaignChannelId}`);
    revalidatePath(`/campaigns/${campaignId}/channels/${campaignChannelId}/allocations/${allocationId}`);
    return null;
  });
}
