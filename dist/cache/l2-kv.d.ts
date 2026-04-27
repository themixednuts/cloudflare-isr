import { CacheLayer, Logger } from '../types.ts';
import { StorageKey } from '../keys.ts';
/**
 * Creates an L2 cache layer backed by Cloudflare KV.
 *
 * KV is globally consistent (eventually) and persists data across colos.
 * Stale entries are intentionally kept (no expirationTtl) so they can be
 * served while background revalidation occurs.
 *
 * Body and response headers are stored in the KV **value** (as JSON).
 * Only small metadata (createdAt, revalidateAfter, status, tags) is stored
 * in the KV **metadata** field to stay within the 1024-byte limit.
 */
export declare function createL2Kv<KVKey extends string = StorageKey>(kv: KVNamespace<KVKey>, logger?: Logger): CacheLayer;
