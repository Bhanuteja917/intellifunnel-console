"use server";

import { revalidatePath } from "next/cache";
import type { CampaignChannelStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";
import { submitChannelForApproval, withdrawChannelFromApproval } from "@/lib/campaigns/state-machine";

export async function updateChannelAction(input: {
  campaignId: string; // only for revalidatePath
  campaignChannelId: string;
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await updateCampaignChannel(db, actor, input.campaignChannelId, {
      contractedQuantity: input.contractedQuantity,
      clientUnitPrice: input.clientUnitPrice,
      costBudget: input.costBudget === undefined || input.costBudget === "" ? undefined : input.costBudget,
      currency: input.currency,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return null;
  });
}

export async function setChannelStatusAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
  status: CampaignChannelStatus,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStatus(db, actor, { channelId, status });
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function submitChannelForApprovalAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await submitChannelForApproval(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function withdrawChannelFromApprovalAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await withdrawChannelFromApproval(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}
