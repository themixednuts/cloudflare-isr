export type PageKey = `page:${string}`;
export type LockKey = `lock:${string}`;
export type StorageKey = PageKey | LockKey;

/** Returns the KV key for a cached response. */
export function pageKey(key: string): PageKey {
  return `page:${key}`;
}

/** Returns the KV key for a revalidation lock. */
export function lockKey(key: string): LockKey {
  return `lock:${key}`;
}

/**
 * Returns a fake URL suitable for the Cache API.
 * The Cache API requires a URL-like key.
 */
export function cacheApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://isr.internal${normalized}`;
}
