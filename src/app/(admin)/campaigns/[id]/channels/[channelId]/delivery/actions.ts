"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { upsertDeliveryConfig, setDeliveryConfigStatus, type DeliveryConfigInput } from "@/lib/delivery/config";
import { retryDeliveryRun } from "@/lib/delivery/runs";

export async function saveDeliveryConfigAction(
  campaignId: string, // only for revalidatePath
  input: DeliveryConfigInput,
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const config = await upsertDeliveryConfig(db, actor, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${input.campaignChannelId}/delivery`);
    return { id: config.id };
  });
}

export async function setDeliveryConfigStatusAction(
  campaignId: string, // only for revalidatePath
  campaignChannelId: string,
  status: "active" | "paused",
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setDeliveryConfigStatus(db, actor, campaignChannelId, status);
    revalidatePath(`/campaigns/${campaignId}/channels/${campaignChannelId}/delivery`);
    return null;
  });
}

export async function retryDeliveryRunAction(
  campaignId: string, // only for revalidatePath
  campaignChannelId: string,
  runId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await retryDeliveryRun(db, actor, runId);
    revalidatePath(`/campaigns/${campaignId}/channels/${campaignChannelId}/delivery`);
    return null;
  });
}
