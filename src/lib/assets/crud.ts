import type { Asset, AssetType, AssetVersion, PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
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

  return db.$transaction(async (tx) => {
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
}
