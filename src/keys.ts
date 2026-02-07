export type PageKey = `page:${string}`;
export type LockKey = `lock:${string}`;
export type StorageKey = PageKey | LockKey;

/** Maximum KV key length in bytes. KV limit is 512; we use 480 for safety margin. */
export const MAX_KEY_LENGTH = 480;

/**
 * djb2 hash — fast, deterministic string hash.
 * Returns a hex string.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
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
  return `${prefix}hash:${djb2Hash(path)}` as `${P}${string}`;
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
