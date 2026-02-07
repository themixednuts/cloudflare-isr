import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheLayer,
  CacheLayerResult,
} from "../types.ts";
import { pageKey, type StorageKey } from "../keys.ts";
import { determineCacheStatus, fitMetadataTags } from "../utils.ts";
import { logWarn } from "../logger.ts";
import type { Logger } from "../types.ts";

/**
 * Shape stored as the KV text value. Body and headers live here so that
 * the KV metadata field (limited to 1024 bytes) only carries small fields.
 */
interface KvValue {
  /** The cached response body. */
  body: string;
  /** Response headers serialized alongside the body. */
  headers: Record<string, string>;
}

/**
 * Creates an L2 cache layer backed by Cloudflare KV.
 *
 * KV is globally consistent (eventually) and persists data across colos.
 * Stale entries are intentionally kept (no expirationTtl) so they can be
 * served while background revalidation occurs.
 *
 * Body and response headers are stored in the KV **value** (as JSON).
 * Only small metadata (createdAt, revalidateAfter, status, tags) is stored
 * in the KV **metadata** field to stay within the 1024-byte limit.
 */
export function createL2Kv<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
  logger?: Logger,
): CacheLayer {
  return {
    async get(path: string): Promise<CacheLayerResult> {
      const key = pageKey(path) as KVKey;
      const { value, metadata } =
        await kv.getWithMetadata<CacheEntryMetadata>(key, "text");

      if (value === null || metadata === null) {
        return { entry: null, status: "MISS" };
      }

      // Parse the stored value — may be the new JSON format or legacy plain body.
      let body: string;
      let headers: Record<string, string>;
      try {
        const parsed = JSON.parse(value) as KvValue;
        if (typeof parsed === "object" && parsed !== null && "body" in parsed) {
          if (typeof parsed.body !== "string") {
            logWarn(logger, "KV entry has non-string body, treating as cache miss");
            return { entry: null, status: "MISS" };
          }
          if (
            parsed.headers !== undefined &&
            parsed.headers !== null &&
            (typeof parsed.headers !== "object" || Array.isArray(parsed.headers))
          ) {
            logWarn(logger, "KV entry has invalid headers, treating as cache miss");
            return { entry: null, status: "MISS" };
          }
          body = parsed.body;
          headers = parsed.headers ?? {};
        } else {
          // Not our format — treat entire value as body (shouldn't happen).
          body = value;
          headers = {};
        }
      } catch {
        // Legacy entries stored body as plain text (before the format change).
        body = value;
        headers = {};
      }

      const entry: CacheEntry = { body, headers, metadata };
      const now = Date.now();
      const status = determineCacheStatus(metadata.revalidateAfter, now);

      return { entry, status };
    },

    async put(path: string, entry: CacheEntry): Promise<void> {
      const key = pageKey(path) as KVKey;
      const kvValue: KvValue = { body: entry.body, headers: entry.headers };
      // Tags should already be pre-truncated by createCacheEntry, but apply
      // fitMetadataTags as a safety net to ensure KV metadata stays < 1024B.
      const fittedTags = fitMetadataTags(entry.metadata, logger);
      const metadata = fittedTags !== entry.metadata.tags
        ? { ...entry.metadata, tags: fittedTags }
        : entry.metadata;
      await kv.put(key, JSON.stringify(kvValue), { metadata });
    },

    async delete(path: string): Promise<void> {
      const key = pageKey(path) as KVKey;
      await kv.delete(key);
    },
  };
}
