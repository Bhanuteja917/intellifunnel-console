import { Prisma, type Asset, type AssetType, type AssetVersion, type PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import type { StorageAdapter } from "@/lib/storage";

export type CreateAssetInput = {
  ownerOrganizationId: string;
  name: string;
  type: AssetType;
  language: string;
};

export async function createAsset(
  db: PrismaClient,
  actor: Actor,
  input: CreateAssetInput,
): Promise<Asset> {
  assertPermission(actor, "asset:write");
  return db.asset.create({
    data: {
      ownerOrganizationId: input.ownerOrganizationId,
      name: input.name,
      type: input.type,
      language: input.language,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });
}

export type UploadAssetVersionInput = {
  assetId: string;
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
};

/**
 * Writes the file to storage first, then commits the AssetVersion row and
 * Asset.currentVersionId update in a single transaction. Ordering matters: a
 * DB row referencing a file that was never written is the failure mode worth
 * avoiding, while an orphaned file from a storage write that succeeds just
 * before a failed DB transaction is a cheap, acceptable cost.
 */
export async function uploadAssetVersion(
  db: PrismaClient,
  actor: Actor,
  storage: StorageAdapter,
  input: UploadAssetVersionInput,
): Promise<AssetVersion> {
  assertPermission(actor, "asset:write");

  const asset = await db.asset.findUnique({ where: { id: input.assetId } });
  if (asset === null) throw new NotFoundError("Asset not found");

  const lastVersion = await db.assetVersion.findFirst({
    where: { assetId: input.assetId },
    orderBy: { version: "desc" },
  });
  const version = (lastVersion?.version ?? 0) + 1;
  const key = `assets/${input.assetId}/${version}-${input.file.fileName}`;

  await storage.put(key, input.file.buffer, input.file.mimeType);

  try {
    return await db.$transaction(async (tx) => {
      const assetVersion = await tx.assetVersion.create({
        data: {
          assetId: input.assetId,
          version,
          storageKey: key,
          fileName: input.file.fileName,
          mimeType: input.file.mimeType,
          sizeBytes: input.file.sizeBytes,
          uploadedById: actor.userId,
        },
      });
      await tx.asset.update({
        where: { id: input.assetId },
        data: { currentVersionId: assetVersion.id, updatedById: actor.userId },
      });
      return assetVersion;
    });
  } catch (error) {
    // (assetId, version) is @unique — a concurrent upload to the same asset
    // can race this read-then-increment; surface it as a friendly error
    // rather than a raw Prisma error. The just-written file at `key` is left
    // in place, an acceptable orphan per this function's own doc comment.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationError("Another version was just uploaded for this asset — try again");
    }
    throw error;
  }
}
