import { Prisma, type AssetPlacement, type AssetPlacementStatus, type PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";

export type CreateAssetPlacementInput = {
  campaignChannelId: string;
  assetId: string;
  assetVersionId: string;
  landingPageUrl: string;
  formSlug: string;
  consentTextVersionId?: string;
};

export async function createAssetPlacement(
  db: PrismaClient,
  actor: Actor,
  input: CreateAssetPlacementInput,
): Promise<AssetPlacement> {
  assertPermission(actor, "asset:write");

  // A placement pinned to the wrong asset's version would silently serve the
  // wrong file later, so this is checked explicitly rather than relying on
  // the two foreign keys alone (both are independently valid; only their
  // combination can be wrong).
  const assetVersion = await db.assetVersion.findUnique({ where: { id: input.assetVersionId } });
  if (assetVersion === null) throw new NotFoundError("Asset version not found");
  if (assetVersion.assetId !== input.assetId) {
    throw new ValidationError("The selected version does not belong to the selected asset");
  }

  try {
    return await db.assetPlacement.create({
      data: {
        campaignChannelId: input.campaignChannelId,
        assetId: input.assetId,
        assetVersionId: input.assetVersionId,
        landingPageUrl: input.landingPageUrl,
        formSlug: input.formSlug,
        consentTextVersionId: input.consentTextVersionId,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  } catch (error) {
    // formSlug is @unique — surface the constraint violation as a friendly
    // error rather than letting the raw Prisma error reach the UI.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationError(`Form slug already in use: ${input.formSlug}`);
    }
    throw error;
  }
}

export type SetPlacementStatusInput = {
  placementId: string;
  status: AssetPlacementStatus;
};

export async function setPlacementStatus(
  db: PrismaClient,
  actor: Actor,
  input: SetPlacementStatusInput,
): Promise<AssetPlacement> {
  assertPermission(actor, "asset:write");

  const existing = await db.assetPlacement.findUnique({ where: { id: input.placementId } });
  if (existing === null) throw new NotFoundError("Placement not found");

  // AssetPlacementStatus transitions are unrestricted (draft/active/paused/
  // archived, any -> any) — the PRD doesn't specify a constrained flow here.
  return db.assetPlacement.update({
    where: { id: input.placementId },
    data: { status: input.status, updatedById: actor.userId },
  });
}
