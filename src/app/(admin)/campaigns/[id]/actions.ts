"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  setIcpCriteria,
  setLeadFieldSpec,
  type IcpCriterionInput,
  type LeadFieldSpecInput,
} from "@/lib/campaigns/crud";

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

export async function setLeadFieldSpecAction(
  campaignId: string,
  fields: LeadFieldSpecInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setLeadFieldSpec(db, actor, campaignId, fields);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}
