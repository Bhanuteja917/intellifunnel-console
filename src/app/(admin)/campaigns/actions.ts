"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { cloneCampaign } from "@/lib/campaigns/clone";
import { createCampaign, deleteCampaign } from "@/lib/campaigns/crud";

export async function createCampaignAction(input: {
  clientOrganizationId: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  currency: string;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const campaign = await createCampaign(db, actor, {
      clientOrganizationId: input.clientOrganizationId,
      name: input.name,
      code: input.code,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      currency: input.currency,
    });
    revalidatePath("/campaigns");
    return { id: campaign.id };
  });
}

export async function deleteCampaignAction(campaignId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await deleteCampaign(db, actor, campaignId);
    revalidatePath("/campaigns");
    return null;
  });
}

export async function cloneCampaignAction(
  campaignId: string,
  overrides: { code: string; name?: string; startDate: string; endDate: string },
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const clone = await cloneCampaign(db, actor, campaignId, {
      code: overrides.code,
      name: overrides.name,
      startDate: new Date(overrides.startDate),
      endDate: new Date(overrides.endDate),
    });
    revalidatePath("/campaigns");
    return { id: clone.id };
  });
}
