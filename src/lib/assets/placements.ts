import { Prisma, type AssetPlacement, type AssetPlacementStatus, type PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { getPlacementApprovalStatus } from "@/lib/approvals/status";

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

  const asset = await db.asset.findUniqueOrThrow({ where: { id: input.assetId } });
  if (asset.status !== "active") {
    throw new ValidationError(`Cannot place asset "${asset.name}" while it is ${asset.status} — it must be active`);
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

  // Moving a placement TO "active" requires its asset to itself be active —
  // an operator can flip an Asset back to draft/archived after a placement
  // using it was already approved, and this is the one point that catches
  // it. Moving to any other status (paused/archived/back to draft) doesn't
  // put the asset in front of a lead, so it's unrestricted either way.
  if (input.status === "active") {
    const asset = await db.asset.findUniqueOrThrow({ where: { id: existing.assetId } });
    if (asset.status !== "active") {
      throw new ValidationError(`Cannot activate this placement — its asset "${asset.name}" is ${asset.status}, not active`);
    }

    // The client signs off on the live landing page URL before it can collect
    // leads. A later edit to the placement makes the old approval stale (its
    // snapshot stops matching), which reads as not-approved here.
    const approvalStatus = await getPlacementApprovalStatus(db, existing);
    if (approvalStatus !== "approved") {
      throw new ValidationError(
        approvalStatus === "reapprovalNeeded"
          ? "This placement changed since the client approved it — it needs approval again before going live"
          : "The client has not approved this placement's landing page URL yet",
      );
    }
  }

  return db.assetPlacement.update({
    where: { id: input.placementId },
    data: { status: input.status, updatedById: actor.userId },
  });
}
