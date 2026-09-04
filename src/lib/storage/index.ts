import { requireEnv } from "@/lib/env";
import { createLocalStorageAdapter } from "./local-adapter";
import { createS3StorageAdapter } from "./s3-adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

function createAdapter(): StorageAdapter {
  if (process.env.STORAGE_DRIVER === "s3") {
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
export function getStorageAdapter(): StorageAdapter {
  if (!instance) {
    instance = createAdapter();
  }
  return instance;
}
