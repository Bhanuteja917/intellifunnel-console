"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setOrganizationRetentionOverride } from "@/lib/organizations/crud";
import { eraseContactNow } from "@/lib/compliance/retention";

export async function setRetentionOverrideAction(input: {
  organizationId: string;
  months: number | null;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setOrganizationRetentionOverride(db, actor, input.organizationId, input.months);
    revalidatePath("/compliance");
    return null;
  });
}

export async function eraseContactNowAction(contactId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await eraseContactNow(db, actor, contactId);
    revalidatePath("/compliance");
    return null;
  });
}
