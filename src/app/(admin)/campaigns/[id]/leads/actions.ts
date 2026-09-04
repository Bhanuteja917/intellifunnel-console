"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { submitLeadFile } from "@/lib/leads/intake";

export async function submitLeadFileAction(input: {
  campaignChannelId: string;
  campaignId: string; // only for revalidatePath — not passed into submitLeadFile
  sourceType: "internal" | "partner";
  content: string;
  mapping: Record<string, string>;
}): Promise<ActionResult<{ submissionId: string; rowsTotal: number; rowsAccepted: number; rowsFailed: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await submitLeadFile(db, actor, {
      campaignChannelId: input.campaignChannelId,
      sourceType: input.sourceType,
      content: input.content,
      mapping: input.mapping,
    });
    revalidatePath(`/campaigns/${input.campaignId}/leads`);
    return result;
  });
}
