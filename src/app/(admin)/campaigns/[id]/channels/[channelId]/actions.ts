"use server";

import { revalidatePath } from "next/cache";
import type { CampaignChannelStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setChannelStatus } from "@/lib/campaigns/channels";

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
