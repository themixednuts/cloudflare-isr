export type PageKey = `page:${string}`;
export type LockKey = `lock:${string}`;
export type StorageKey = PageKey | LockKey;

/** Maximum KV key length in bytes. KV limit is 512; we use 480 for safety margin. */
export const MAX_KEY_LENGTH = 480;

/**
 * 64-bit hash combining djb2 and FNV-1a for cache key collision resistance.
 *
 * Single 32-bit hash (djb2) has a birthday bound of ~77K keys.
 * Dual-hash produces 64 bits, raising the bound to ~4 billion.
 *
 * @see OWASP Web Cache Poisoning -- weak hashes allow crafted URL collisions
 */
function keyHash(str: string): string {
  let h1 = 5381;          // djb2
  let h2 = 0x811c9dc5;    // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 ^ c) * 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * If the full key (prefix + path) would exceed MAX_KEY_LENGTH bytes,
 * replace the path portion with its hash to stay within the limit.
 */
function safeKey<P extends string>(prefix: P, path: string): `${P}${string}` {
  const full = `${prefix}${path}`;
  // Use TextEncoder to measure actual byte length (handles multi-byte chars)
  const byteLength = new TextEncoder().encode(full).byteLength;
  if (byteLength <= MAX_KEY_LENGTH) {
    return full as `${P}${string}`;
  }
  return `${prefix}hash:${keyHash(path)}` as `${P}${string}`;
}

/** Returns the KV key for a cached response. */
export function pageKey(key: string): PageKey {
  return safeKey("page:", key) as PageKey;
}

/** Returns the KV key for a revalidation lock. */
export function lockKey(key: string): LockKey {
  return safeKey("lock:", key) as LockKey;
}

/**
 * Returns a fake URL suitable for the Cache API.
 * The Cache API requires a URL-like key.
 */
export function cacheApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://isr.internal${normalized}`;
}

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
export function normalizeCacheKey(url: URL): string {
  let path = url.pathname;
  // Collapse consecutive slashes
  path = path.replace(/\/{2,}/g, "/");
  // Strip trailing slash (except root)
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}
