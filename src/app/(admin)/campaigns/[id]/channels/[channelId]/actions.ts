"use server";

import { revalidatePath } from "next/cache";
import type { CampaignChannelStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";

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

export async function setChannelStatusAction(input: {
  campaignId: string; // only for revalidatePath
  campaignChannelId: string;
  status: CampaignChannelStatus;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStatus(db, actor, {
      campaignChannelId: input.campaignChannelId,
      status: input.status,
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return null;
  });
}
