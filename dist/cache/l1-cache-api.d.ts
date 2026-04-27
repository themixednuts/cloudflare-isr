import { CacheLayer } from '../types.ts';
/**
 * Creates an L1 cache layer backed by the Cloudflare Cache API.
 *
 * The Cache API is per-colo and provides very fast reads, but entries are
 * not globally consistent. This makes it ideal as a first-tier cache that
 * sits in front of the globally-consistent KV store.
 */
export declare function createL1CacheApi(cacheName: string): CacheLayer;
