import type { ISRStorage, Logger } from "../types.ts";
import type { TagIndex } from "../revalidation/tag-index.ts";
import { createKvLock } from "../revalidation/lock.ts";
import { createL1CacheApi } from "../cache/l1-cache-api.ts";
import { createL2Kv } from "../cache/l2-kv.ts";
import { createTwoTierCache } from "../cache/two-tier-cache.ts";
import type { StorageKey } from "../keys.ts";

export interface WorkersStorageOptions<KVKey extends string = StorageKey> {
  /** KV namespace used for cache storage. */
  kv: KVNamespace<KVKey>;
  /** Tag index implementation. */
  tagIndex: TagIndex;
  /** Optional logger hook for cache warnings. */
  logger?: Logger;
  /** Cache API namespace (default: "isr"). */
  cacheName?: string;
}

/**
 * Create a Cloudflare Workers storage implementation (Cache API + KV).
 */
export function createWorkersStorage<KVKey extends string = StorageKey>(
  options: WorkersStorageOptions<KVKey>,
): ISRStorage {
  const cacheName = options.cacheName ?? "isr";
  const l1 = createL1CacheApi(cacheName);
  const l2 = createL2Kv(options.kv, options.logger);
  const cache = createTwoTierCache(l1, l2, options.logger);
  const tagIndex = options.tagIndex;
  const lock = createKvLock<KVKey>(options.kv, options.logger);

  return { cache, tagIndex, lock };
}
