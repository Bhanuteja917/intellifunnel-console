/**
 * Storage abstraction for asset binaries (PRD Epic E5). Two adapters exist:
 * a local-disk adapter for development (src/lib/storage/local-adapter.ts) and
 * an S3-compatible adapter for production/staging (s3-adapter.ts). Callers
 * should obtain an instance via getStorageAdapter() (index.ts) rather than
 * constructing an adapter directly, so the driver choice stays centralized.
 */
export type StorageAdapter = {
  /** Write content to key, creating any parent "directories" as needed. */
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  /**
   * Return a URL the caller can use to download the object at key. What
   * "download" means differs by adapter — see the doc comment on each
   * adapter's factory function.
   */
  getDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Remove the object at key. Deleting an already-missing key is not an error. */
  delete(key: string): Promise<void>;
};
