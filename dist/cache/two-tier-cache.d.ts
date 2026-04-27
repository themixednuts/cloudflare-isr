import { CacheLayer, Logger } from '../types.ts';
/**
 * Creates a composed two-tier cache that checks L1 first, then L2.
 *
 * - **L1** (Cache API): per-colo, very fast, not globally consistent.
 * - **L2** (KV): global, eventually consistent, higher latency.
 *
 * On `get`, L1 is checked first. A HIT is returned immediately. On L1 STALE
 * or MISS, L2 is consulted to pick the freshest entry and back-fill L1 when
 * a fresh entry is found there.
 *
 * On `put` and `delete`, both layers are updated in parallel.
 */
export declare function createTwoTierCache(l1: CacheLayer, l2: CacheLayer, logger?: Logger): CacheLayer;
