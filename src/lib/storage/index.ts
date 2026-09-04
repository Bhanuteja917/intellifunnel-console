import { ValidationError } from "@/lib/errors";
import { createLocalStorageAdapter } from "./local-adapter";
import { createS3StorageAdapter } from "./s3-adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

function requireS3Env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new ValidationError(
      `Missing required environment variable: ${name}. STORAGE_DRIVER=s3 was ` +
        `selected, so this must be set (see .env.example) — falling back to ` +
        `local storage silently would put assets on disk where the app ` +
        `expects them in the bucket.`,
    );
  }
  return value;
}

function createAdapter(): StorageAdapter {
  if (process.env.STORAGE_DRIVER === "s3") {
    return createS3StorageAdapter({
      bucket: requireS3Env("S3_BUCKET"),
      region: requireS3Env("S3_REGION"),
      accessKeyId: requireS3Env("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireS3Env("S3_SECRET_ACCESS_KEY"),
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
