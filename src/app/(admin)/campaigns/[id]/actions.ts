"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setIcpCriteria, type IcpCriterionInput } from "@/lib/campaigns/crud";

export async function setIcpCriteriaAction(
  campaignId: string,
  criteria: IcpCriterionInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setIcpCriteria(db, actor, campaignId, criteria);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}
