"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { deactivateChannelType } from "@/lib/channel-types/crud";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";

export async function publishChannelTypeAction(
  channelTypeId: string,
): Promise<ActionResult<{ version: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const version = await publishChannelTypeVersion(db, actor, channelTypeId);
    revalidatePath("/channel-types");
    return { version: version.version };
  });
}

export async function deactivateChannelTypeAction(
  channelTypeId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await deactivateChannelType(db, actor, channelTypeId);
    revalidatePath("/channel-types");
    return null;
  });
}
