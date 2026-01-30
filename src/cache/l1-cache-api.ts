import type { CacheEntry, CacheLayer, CacheLayerResult } from "../types.ts";
import { cacheApiUrl } from "../keys.ts";
import { determineCacheStatus } from "../utils.ts";

/**
 * Creates an L1 cache layer backed by the Cloudflare Cache API.
 *
 * The Cache API is per-colo and provides very fast reads, but entries are
 * not globally consistent. This makes it ideal as a first-tier cache that
 * sits in front of the globally-consistent KV store.
 */
export function createL1CacheApi(cacheName: string): CacheLayer {
  const FOREVER_TTL_SECONDS = 60 * 60 * 24 * 365;

  return {
    async get(path: string): Promise<CacheLayerResult> {
      const cache = await caches.open(cacheName);
      const url = cacheApiUrl(path);
      const response = await cache.match(url);

      if (!response) {
        return { entry: null, status: "MISS" };
      }

      const entry: CacheEntry = await response.json();
      const now = Date.now();
      const status = determineCacheStatus(entry.metadata.revalidateAfter, now);

      return { entry, status };
    },

    async put(path: string, entry: CacheEntry): Promise<void> {
      const cache = await caches.open(cacheName);
      const url = cacheApiUrl(path);

      const remainingSeconds =
        entry.metadata.revalidateAfter === null
          ? FOREVER_TTL_SECONDS
          : Math.max(
              0,
              Math.floor((entry.metadata.revalidateAfter - Date.now()) / 1000),
            );

      const response = new Response(JSON.stringify(entry), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `s-maxage=${remainingSeconds}`,
        },
      });

      await cache.put(url, response);
    },

    async delete(path: string): Promise<void> {
      const cache = await caches.open(cacheName);
      const url = cacheApiUrl(path);
      await cache.delete(url);
    },
  };
}
