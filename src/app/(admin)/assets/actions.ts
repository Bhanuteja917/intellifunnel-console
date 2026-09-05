"use server";

import { revalidatePath } from "next/cache";
import type { AssetType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { createAsset, uploadAssetVersion } from "@/lib/assets/crud";
import { getStorageAdapter } from "@/lib/storage";
import { ValidationError } from "@/lib/errors";

export async function createAssetAction(input: {
  ownerOrganizationId: string;
  name: string;
  type: AssetType;
  language: string;
}): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const asset = await createAsset(db, actor, input);
    revalidatePath("/assets");
    return { id: asset.id };
  });
}

export async function uploadAssetVersionAction(
  formData: FormData,
): Promise<ActionResult<{ id: string; version: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    const assetId = formData.get("assetId");
    const file = formData.get("file");
    if (typeof assetId !== "string" || assetId === "") {
      throw new ValidationError("Missing assetId");
    }
    if (!(file instanceof File)) {
      throw new ValidationError("Missing file");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const assetVersion = await uploadAssetVersion(db, actor, await getStorageAdapter(), {
      assetId,
      file: {
        buffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: buffer.byteLength,
      },
    });
    revalidatePath(`/assets/${assetId}`);
    return { id: assetVersion.id, version: assetVersion.version };
  });
}

export async function setAssetStatusAction(
  assetId: string,
  status: "draft" | "active" | "archived",
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPermission(actor, "asset:write");
    await db.asset.update({
      where: { id: assetId },
      data: { status, updatedById: actor.userId },
    });
    revalidatePath(`/assets/${assetId}`);
    return null;
  });
}
