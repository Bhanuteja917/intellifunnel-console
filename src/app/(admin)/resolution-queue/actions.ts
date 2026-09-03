"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  rematchEntry,
  resolveEntryByCreatingAccount,
  resolveEntryToAccount,
} from "@/lib/identity/resolution-queue";

export async function resolveEntryAction(
  entryId: string,
  accountId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await resolveEntryToAccount(db, actor, entryId, accountId);
    revalidatePath("/resolution-queue");
    return null;
  });
}

export async function createAccountForEntryAction(
  entryId: string,
): Promise<ActionResult<{ accountId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await resolveEntryByCreatingAccount(db, actor, entryId);
    revalidatePath("/resolution-queue");
    return result;
  });
}

export async function rematchEntryAction(entryId: string): Promise<ActionResult<{ status: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const status = await rematchEntry(db, actor, entryId);
    revalidatePath("/resolution-queue");
    return { status };
  });
}
