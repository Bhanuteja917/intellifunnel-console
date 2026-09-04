import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./types";

/**
 * Local-disk storage adapter, used whenever STORAGE_DRIVER is unset or not
 * "s3". Files live under baseDir (default ".data/asset-storage", gitignored)
 * relative to the process working directory.
 *
 * getDownloadUrl is a deliberate dev-only shortcut, not a general-purpose
 * signed URL: this adapter only ever backs the authenticated admin download
 * route (added in a later task), which knows to take the key back out of the
 * returned path and read the file itself. It is NOT a URL a browser can use
 * unauthenticated, unlike the S3 adapter's real presigned URL.
 */
export function createLocalStorageAdapter(
  baseDir: string = ".data/asset-storage",
): StorageAdapter {
  function resolvePath(key: string): string {
    // Keys may eventually be derived from user-supplied filenames; refuse
    // anything that could escape baseDir via a ".." segment.
    if (key.split(/[\\/]/).some((segment) => segment === "..")) {
      throw new Error(`Invalid storage key (contains a ".." segment): ${key}`);
    }
    return path.join(baseDir, key);
  }

  return {
    async put(key, content) {
      const filePath = resolvePath(key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    },

    async getDownloadUrl(key) {
      return `/api/assets/local/${encodeURIComponent(key)}`;
    },

    async delete(key) {
      const filePath = resolvePath(key);
      // force: true swallows ENOENT — deleting an already-missing key is not
      // an error.
      await rm(filePath, { force: true });
    },
  };
}
