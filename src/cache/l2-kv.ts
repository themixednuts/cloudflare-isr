import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheLayer,
  CacheLayerResult,
} from "../types.ts";
import { pageKey, type StorageKey } from "../keys.ts";
import { determineCacheStatus } from "../utils.ts";

/**
 * Creates an L2 cache layer backed by Cloudflare KV.
 *
 * KV is globally consistent (eventually) and persists data across colos.
 * Stale entries are intentionally kept (no expirationTtl) so they can be
 * served while background revalidation occurs.
 */
export function createL2Kv<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
): CacheLayer {
  return {
    async get(path: string): Promise<CacheLayerResult> {
      const key = pageKey(path) as KVKey;
      const { value, metadata } =
        await kv.getWithMetadata<CacheEntryMetadata>(key, "text");

      if (value === null || metadata === null) {
        return { entry: null, status: "MISS" };
      }

      const entry: CacheEntry = {
        body: value,
        metadata,
      };

      const now = Date.now();
      const status = determineCacheStatus(metadata.revalidateAfter, now);

      return { entry, status };
    },

    async put(path: string, entry: CacheEntry): Promise<void> {
      const key = pageKey(path) as KVKey;
      await kv.put(key, entry.body, { metadata: entry.metadata });
    },

    async delete(path: string): Promise<void> {
      const key = pageKey(path) as KVKey;
      await kv.delete(key);
    },
  };
}
