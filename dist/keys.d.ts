export type PageKey = `page:${string}`;
export type LockKey = `lock:${string}`;
export type StorageKey = PageKey | LockKey;
/** Maximum KV key length in bytes. KV limit is 512; we use 480 for safety margin. */
export declare const MAX_KEY_LENGTH = 480;
/** Returns the KV key for a cached response. */
export declare function pageKey(key: string): PageKey;
/** Returns the KV key for a revalidation lock. */
export declare function lockKey(key: string): LockKey;
/**
 * Returns a fake URL suitable for the Cache API.
 * The Cache API requires a URL-like key. Encode the full cache key into the
 * path so keys containing `?` do not collapse to the same URL pathname.
 */
export declare function cacheApiUrl(key: string): string;
/**
 * Normalize a URL path to prevent Web Cache Deception attacks.
 *
 * Without normalization, paths like `/profile` and `/profile/` produce
 * different cache keys. An attacker can exploit this to cache sensitive
 * content under a path the origin treats as equivalent.
 *
 * Normalizations applied:
 * - Collapse consecutive slashes: `//foo///bar` → `/foo/bar`
 * - Strip trailing slash (except root `/`): `/page/` → `/page`
 * - Ensure leading slash: `page` → `/page`
 *
 * Use with `cacheKey` option to opt in:
 * ```ts
 * import { createISR, normalizeCacheKey } from "cloudflare-isr";
 * const isr = createISR({ cacheKey: normalizeCacheKey, ... });
 * ```
 *
 * @see Web Cache Deception (Black Hat 2024) -- path confusion enables cached content theft
 */
export declare function normalizeCacheKey(url: URL): string;
/**
 * Default cache key strategy used by ISR internals.
 *
 * Includes a normalized pathname and a stable, sorted query string so
 * query-varying pages do not collide in cache by default.
 */
export declare function defaultCacheKey(url: URL): string;
