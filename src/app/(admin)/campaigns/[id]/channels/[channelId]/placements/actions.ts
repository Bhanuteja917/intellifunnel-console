"use server";

import { revalidatePath } from "next/cache";
import type { AssetPlacementStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createAssetPlacement, setPlacementStatus } from "@/lib/assets/placements";
import { ValidationError } from "@/lib/errors";

export async function createAssetPlacementAction(input: {
  campaignId: string; // only for revalidatePath — not passed into createAssetPlacement
  campaignChannelId: string;
  assetId: string;
  assetVersionId: string;
  landingPageUrl: string;
  formSlug: string;
  consentTextVersionId?: string;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    const landingPageUrl = input.landingPageUrl.trim();
    const formSlug = input.formSlug.trim();
    if (landingPageUrl === "") throw new ValidationError("Landing page URL is required");
    if (formSlug === "") throw new ValidationError("Form slug is required");

    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: input.campaignChannelId,
      assetId: input.assetId,
      assetVersionId: input.assetVersionId,
      landingPageUrl,
      formSlug,
      consentTextVersionId: input.consentTextVersionId,
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}/placements`);
    return { id: placement.id };
  });
}

export async function setPlacementStatusAction(
  campaignId: string, // only for revalidatePath
  campaignChannelId: string, // only for revalidatePath
  placementId: string,
  status: AssetPlacementStatus,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setPlacementStatus(db, actor, { placementId, status });
    revalidatePath(`/campaigns/${campaignId}/channels/${campaignChannelId}/placements`);
    return null;
  });
}
