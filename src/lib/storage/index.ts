import { requireEnv } from "@/lib/env";
import { createLocalStorageAdapter } from "./local-adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

async function createAdapter(): Promise<StorageAdapter> {
  if (process.env.STORAGE_DRIVER === "s3") {
    // Dynamic import so local dev (STORAGE_DRIVER unset) never pulls in
    // @aws-sdk/client-s3 / @aws-sdk/s3-request-presigner at module-load time.
    const { createS3StorageAdapter } = await import("./s3-adapter");
    return createS3StorageAdapter({
      bucket: requireEnv("S3_BUCKET"),
      region: requireEnv("S3_REGION"),
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    });
  }
  // Anything else, including unset, is the local-disk adapter — the intended
  // default for local development.
  return createLocalStorageAdapter();
}

let instance: StorageAdapter | undefined;

/** Returns the process-wide storage adapter, constructing it on first use. */
export async function getStorageAdapter(): Promise<StorageAdapter> {
  if (!instance) {
    instance = await createAdapter();
  }
  return instance;
}
