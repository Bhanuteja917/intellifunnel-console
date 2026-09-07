"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createDoNotContactEntry, deleteDoNotContactEntry } from "@/lib/compliance/dnc";
import { setOrganizationRetentionOverride } from "@/lib/organizations/crud";
import { eraseContactNow } from "@/lib/compliance/retention";
import type { DoNotContactType } from "@prisma/client";

export async function createDoNotContactEntryAction(input: {
  clientOrganizationId: string;
  type: DoNotContactType;
  rawValue: string;
  reason?: string;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const entry = await createDoNotContactEntry(db, actor, input);
    revalidatePath("/compliance");
    return { id: entry.id };
  });
}

export async function deleteDoNotContactEntryAction(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await deleteDoNotContactEntry(db, actor, id);
    revalidatePath("/compliance");
    return null;
  });
}

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
