import { LockProvider, Logger } from '../types.ts';
import { StorageKey } from '../keys.ts';
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
export declare function acquireLock<KVKey extends string = StorageKey>(kv: KVNamespace<KVKey>, key: string, logger?: Logger): Promise<AsyncDisposable | null>;
export declare function createKvLock<KVKey extends string = StorageKey>(kv: KVNamespace<KVKey>, logger?: Logger): LockProvider;
