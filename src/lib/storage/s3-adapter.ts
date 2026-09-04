import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./types";

export type S3StorageConfig = {
  /** Unset for real AWS S3; set for R2, MinIO, or any other S3-compatible endpoint. */
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * S3-compatible storage adapter. Unlike the local adapter, getDownloadUrl
 * here means exactly what the interface says: a presigned GetObject URL that
 * expires after ttlSeconds and is directly usable by a browser, no
 * authenticated app route required.
 */
export function createS3StorageAdapter(config: S3StorageConfig): StorageAdapter {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    // Path-style addressing is required by most non-AWS S3-compatible
    // endpoints (MinIO, and commonly R2); virtual-hosted-style is what real
    // AWS S3 expects, so only force it when a custom endpoint is in play.
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async put(key, content, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: content,
          ContentType: contentType,
        }),
      );
    },

    async getDownloadUrl(key, ttlSeconds) {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      });
      return getSignedUrl(client, command, { expiresIn: ttlSeconds });
    },

    async delete(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    },
  };
}
