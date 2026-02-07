import type { LockProvider, Logger } from "../types.ts";
import { lockKey, type StorageKey } from "../keys.ts";
import { logWarn } from "../logger.ts";

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
 * @returns An `AsyncDisposable` handle if the lock was acquired, `null` if
 *          another worker holds it. Disposing the handle releases the lock.
 */
export async function acquireLock<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
  key: string,
  logger?: Logger,
): Promise<AsyncDisposable | null> {
  const lock = lockKey(key) as KVKey;
  const existing = await kv.get(lock);

  if (existing !== null) {
    return null;
  }

  await kv.put(lock, Date.now().toString(), { expirationTtl: 60 });
  return {
    async [Symbol.asyncDispose]() {
      try {
        await kv.delete(lock);
      } catch (error) {
        // Lock will expire via TTL (60s) — explicit delete is best-effort optimization
        logWarn(logger, `Failed to release lock "${lock}":`, error);
      }
    },
  };
}

export function createKvLock<KVKey extends string = StorageKey>(
  kv: KVNamespace<KVKey>,
  logger?: Logger,
): LockProvider {
  return {
    acquire: (key) => acquireLock(kv, key, logger),
  };
}
