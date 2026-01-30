import type { LockProvider } from "../types.ts";
import { lockKey, type StorageKey } from "../keys.ts";

/**
 * Try to acquire a distributed lock for the given cache key.
 *
 * This is a best-effort lock backed by KV. It is not atomic but is
 * sufficient for preventing the thundering-herd problem during
 * background revalidation — at worst two workers may revalidate
 * simultaneously, which is harmless.
 *
 * The lock automatically expires after 60 seconds (KV minimum TTL).
 *
 * @returns `true` if the lock was acquired, `false` if another worker holds it.
 */
export async function acquireLock<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
  key: string,
): Promise<boolean> {
  const lock = lockKey(key) as KVKey;
  const existing = await kv.get(lock);

  if (existing !== null) {
    return false;
  }

  await kv.put(lock, Date.now().toString(), { expirationTtl: 60 });
  return true;
}

/**
 * Release the distributed lock for the given cache key.
 */
export async function releaseLock<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
  key: string,
): Promise<void> {
  await kv.delete(lockKey(key) as KVKey);
}

export function createKvLock<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
): LockProvider {
  return {
    acquire: (key) => acquireLock(kv, key),
    release: (key) => releaseLock(kv, key),
  };
}
