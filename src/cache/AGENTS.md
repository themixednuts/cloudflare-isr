# src/cache/ — Two-Tier Cache Layer

Per-colo L1 (Cache API) + global L2 (KV) composed behind unified `CacheLayer` interface.

## CODE MAP

| File | Exports | Purpose |
|------|---------|---------|
| `l1-cache-api.ts` | `createL1CacheApi(cacheName)` | Per-colo cache via `caches.open()` — synthetic URL keys from `cacheApiUrl(path)`, stores serialized `CacheEntry` as Response with `s-maxage` TTL |
| `l2-kv.ts` | `createL2Kv(kv, logger?)` | Global KV layer — value = JSON `{ body, headers }`, metadata = `CacheEntryMetadata` (< 1024 bytes) |
| `two-tier-cache.ts` | `createTwoTierCache(l1, l2, logger?)` | Composition — L1 HIT returns immediately; L1 STALE/MISS checks L2, backfills L1 fire-and-forget if L2 fresher |

**Return type:** All factories return `CacheLayer` = `{ get, put, delete }`

## CONVENTIONS

- `CacheLayerResult` discriminated union: `{ entry: CacheEntry, status: "HIT" | "STALE" }` or `{ entry: null, status: "MISS" }`
- Freshness: `determineCacheStatus(revalidateAfter, now)` from `../utils.ts` — returns `"HIT"` (fresh), `"STALE"` (expired), or `"MISS"` (no entry)
- Keys: `cacheApiUrl(path)` for L1 synthetic URLs, `pageKey(path)` for L2 KV keys — both from `../keys.ts`
- Never throw: all cache reads wrapped in `safeCacheGet()`, writes/deletes use `Promise.allSettled` — failures log warnings and degrade to MISS
- TTL in L1: `Math.ceil((revalidateAfter - now) / 1000)` minimum 1 second; `revalidateAfter === null` gets 1-year TTL (`FOREVER_TTL_SECONDS`)
- No expirationTtl in L2: stale entries persist indefinitely for SWR

## NOTES

- **L1 eviction is implicit** — Cache API auto-evicts based on `s-maxage`; expired entries become misses on next read
- **KV metadata limit (1024 bytes)** — body/headers live in KV value as JSON; metadata only holds `createdAt`, `revalidateAfter`, `status`, truncated `tags`
- **fitMetadataTags()** greedy-drops tags from end if metadata exceeds 1024B — called in `createCacheEntry()` and as safety-net in `l2-kv` put
- **Legacy KV format** — `l2-kv` try/catch fallback: if value is not JSON or missing `body` key, treats entire value as plain-text body (pre-migration entries)
- **Type guards on KV parse** — validates `body` is string, `headers` is object; invalid types log warning and return MISS
- **Backfill is fire-and-forget** — `two-tier-cache` calls `l1.put()` without await, errors caught and logged
- **pickNewestEntry()** — when both L1/L2 are STALE, returns entry with higher `metadata.createdAt`
- **Parallel layer ops** — put/delete use `runLayerOps()` → `Promise.allSettled([l1, l2])` → log failures, never throw
