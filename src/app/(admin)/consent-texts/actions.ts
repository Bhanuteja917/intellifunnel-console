"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createConsentTextVersion } from "@/lib/consent/crud";

export async function createConsentTextVersionAction(input: {
  name: string;
  body: string;
  language: string;
  effectiveFrom: Date;
}): Promise<ActionResult<{ id: string; version: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const consentTextVersion = await createConsentTextVersion(db, actor, input);
    revalidatePath("/consent-texts");
    return { id: consentTextVersion.id, version: consentTextVersion.version };
  });
}
