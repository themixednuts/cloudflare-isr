import { ISRStorage, Logger } from '../types.ts';
import { TagIndex } from '../revalidation/tag-index.ts';
import { StorageKey } from '../keys.ts';
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
export declare function createWorkersStorage<KVKey extends string = StorageKey>(options: WorkersStorageOptions<KVKey>): ISRStorage;
