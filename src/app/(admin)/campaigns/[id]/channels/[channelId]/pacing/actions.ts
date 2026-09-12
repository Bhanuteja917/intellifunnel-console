"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { type PacingBucket } from "@/lib/allocations/pacing";
import { saveSchedule, deleteSchedule } from "@/lib/channels/pacing-schedule";

export async function saveChannelPacingScheduleAction(input: {
  campaignId: string;   // for revalidatePath only
  channelId: string;
  buckets: Array<{ periodStart: string; periodEnd: string; targetQuantity: number }>;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPermission(actor, "campaign:write");
    const buckets: PacingBucket[] = input.buckets.map((b) => ({
      periodStart: new Date(b.periodStart),
      periodEnd: new Date(b.periodEnd),
      targetQuantity: b.targetQuantity,
    }));
    await saveSchedule(db, { id: actor.userId }, input.channelId, buckets);
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.channelId}`);
    return null;
  });
}

export async function deleteChannelPacingScheduleAction(input: {
  campaignId: string;   // for revalidatePath only
  channelId: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPermission(actor, "campaign:write");
    await deleteSchedule(db, input.channelId);
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.channelId}`);
    return null;
  });
}
