"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { importEngagementEvents, type ImportEngagementEventsResult } from "@/lib/reporting/engagement-import";

export async function importEngagementEventsAction(
  fileContent: string,
): Promise<ActionResult<ImportEngagementEventsResult>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await importEngagementEvents(db, actor, { fileContent });
    revalidatePath("/reports");
    return result;
  });
}
