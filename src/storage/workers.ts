import type { ISRStorage, Logger } from "../types.ts";
import type { TagIndex } from "../revalidation/tag-index.ts";
import { createKvLock } from "../revalidation/lock.ts";
import { TagIndexDOClient } from "../revalidation/tag-index.ts";
import { createL1CacheApi } from "../cache/l1-cache-api.ts";
import { createL2Kv } from "../cache/l2-kv.ts";
import { createTwoTierCache } from "../cache/two-tier-cache.ts";
import type { StorageKey } from "../keys.ts";

export type WorkersStorageOptions<
  KVKey extends string = StorageKey,
  TagIndexNamespace extends Rpc.DurableObjectBranded | undefined = undefined,
> =
  | {
      /** KV namespace used for cache storage. */
      kv: KVNamespace<KVKey>;
      /** Tag index implementation. */
      tagIndex: TagIndex;
      /** Optional logger hook for cache warnings. */
      logger?: Logger;
      /** Cache API namespace (default: "isr"). */
      cacheName?: string;
    }
  | {
      /** KV namespace used for cache storage. */
      kv: KVNamespace<KVKey>;
      /** Durable Object binding for the tag index. */
      tagIndexBinding: DurableObjectNamespace<TagIndexNamespace>;
      /** Optional logger hook for cache warnings. */
      logger?: Logger;
      /** Cache API namespace (default: "isr"). */
      cacheName?: string;
    };

/**
 * Create a Cloudflare Workers storage implementation (Cache API + KV).
 */
export function createWorkersStorage<
  KVKey extends string = StorageKey,
  TagIndexNamespace extends Rpc.DurableObjectBranded | undefined = undefined,
>(options: WorkersStorageOptions<KVKey, TagIndexNamespace>): ISRStorage {
  const cacheName = options.cacheName ?? "isr";
  const l1 = createL1CacheApi(cacheName);
  const l2 = createL2Kv(options.kv);
  const cache = createTwoTierCache(l1, l2, options.logger);
  if (!("tagIndex" in options) && !options.tagIndexBinding) {
    throw new Error(
      "[ISR] Tag index is required. Provide tagIndex or tagIndexBinding (Durable Object).",
    );
  }
  const tagIndex =
    "tagIndex" in options
      ? options.tagIndex
      : new TagIndexDOClient(options.tagIndexBinding);
  const lock = createKvLock<KVKey>(options.kv);

  return { cache, tagIndex, lock };
}
