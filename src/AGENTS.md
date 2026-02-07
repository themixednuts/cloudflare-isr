# src/ — Core ISR Engine

**OVERVIEW**: Framework-agnostic ISR runtime: request handling, two-tier caching, tag invalidation, background revalidation.

## WHERE TO LOOK

| File | Purpose |
|------|---------|
| `isr.ts` | `createISR()` factory — returns `ISRInstance` with `handleRequest`, `lookup`, `cache`, `scope`, `revalidatePath/Tag` |
| `types.ts` | All public types; `ISROptions` discriminated union (bindings-shorthand vs custom `ISRStorage` via `never` guards) |
| `render.ts` | `renderer()` self-fetch factory + `ISR_RENDER_HEADER` recursion guard constant (`"1"`) |
| `keys.ts` | `pageKey()`, `lockKey()`, `cacheApiUrl()` — prefixed key generators; djb2 hash for paths >480 bytes (`safeKey`) |
| `route-matcher.ts` | `matchRoute()` — compiles route patterns to regex, cached in `WeakMap`; validates no multiple `*`, <512 chars |
| `bypass.ts` | `isBypass()` — checks `x-isr-bypass` header + `__isr_bypass` cookie via constant-time `safeEqual()` |
| `logger.ts` | `logDebug/Info/Warn/Error` — prefix-aware helpers; warn/error fall back to `console` |
| `utils.ts` | `resolveRevalidate` (3-layer priority), `createCacheEntry`, `safeCacheGet`, `fitMetadataTags` (KV 1024B limit) |
| `cache/` | `CacheLayer` implementations: L1 (Cache API), L2 (KV), composed `TwoTierCache`; see `cache/AGENTS.md` |
| `revalidation/` | `revalidate()`, `createRevalidator()`, `TagIndex`, DO client+class, KV lock; see `revalidation/AGENTS.md` |
| `storage/` | `createWorkersStorage()` — wires L1+L2+lock+tagIndex from raw `Env` bindings, validates presence |
| `adapters/` | Framework middleware (SvelteKit/Nuxt/SolidStart) — thin wrappers around `ISRInstance.handleRequest()` |
| `index.ts` | Public barrel — re-exports `createISR`, `renderer`, `ISRTagIndexDO`, all public types |

## CODE MAP

```
createISR(options) → ISRInstance
  ├─ resolveStorage()         picks bindings-shorthand (kv/tagIndex) vs custom ISRStorage (runtime guard)
  ├─ handleRequest()          full lifecycle: match → bypass? → cache lookup → render (with timeout) → store
  │   ├─ isBypass()           checks header/cookie via constant-time compare
  │   ├─ safeCacheGet()       wrapped get → { entry, status }; failures become MISS
  │   ├─ withTimeout()        Promise.race; renderTimeout × 2 for background (default 25s/50s)
  │   ├─ shouldCacheStatus    default: status < 500; config override
  │   ├─ createCacheEntry()   merges tags (route ∪ render), resolves final TTL (render > route > default > 60s)
  │   └─ waitUntil(revalidate) background: acquires lock, re-renders on STALE, updates cache + tag index
  ├─ lookup()                 cache-only check; returns Response | null (no render)
  ├─ cache()                  stores a framework-rendered Response into ISR cache (no match/bypass)
  ├─ scope()                  per-request config builder: defaults(cfg) + set(k,v) + resolveConfig() → merged RouteConfig
  ├─ revalidatePath()         cache.delete by key; on-demand purge
  └─ revalidateTag()          tagIndex.getKeysByTag → parallel delete with concurrency 25 (`runWithConcurrency`)

RevalidateValue = number | false        (0 = no-store → skip caching, false = cache forever)
CacheStatus     = HIT | STALE | MISS | BYPASS | SKIP
```

## CONVENTIONS (src-specific)

- **RevalidateValue semantics**: positive number = TTL seconds, `0` = no-store (skip caching), `false` = cache forever (no expiry)
- **Revalidate priority**: render result > route config > `defaultRevalidate` > 60s fallback (`DEFAULT_REVALIDATE` in `utils.ts`)
- **Error handling**: all cache/tag operations caught-and-logged, never thrown — graceful degradation to MISS
- **Response building**: `buildResponse()` always sets `X-ISR-Status` and optionally `X-ISR-Cache-Date` (`exposeHeaders` flag)
- **Cache-Control override**: `applyCacheControl()` always adds `private, no-cache` — client must revalidate each request
- **KV metadata limit**: 1024 bytes max; body+headers stored in KV value as JSON, only `CacheEntryMetadata` in metadata
- **Lock lifecycle**: `AsyncDisposable` via `Symbol.asyncDispose` — use `await using lock = ...` for auto-release
- **Cache read wrapper**: `safeCacheGet(layer, key)` wraps all `cache.get()` calls — failures return `{ entry: null, status: "MISS" }`
- **Background work**: all async work via `ctx.waitUntil(promise.catch())` — errors logged, never unhandled
- **Tag truncation**: `fitMetadataTags()` called before both cache.put() and tag index updates — prevents desync on overflow
- **Tag validation**: max 64 tags, 128 chars each, pattern `/^[a-zA-Z0-9_\-.:\/]+$/` — validated in `normalizeTags()`

## NOTES

- `ISRTagIndexDO` must be re-exported from `index.ts` for Wrangler discovery
- `ISRAdapterOptions` is the shared interface for all framework adapters (env, ctx, render, cacheKeyFn, etc.)
- `renderer()` returns a `RenderFunction` that does self-fetch; caller must ensure no recursion (check `ISR_RENDER_HEADER`)
- `shouldCacheStatus` config defaults to `(status) => status < 500` — skip caching server errors
- `exposeHeaders` config defaults to `true` — disabling hides `X-ISR-*` headers from client
- `lockOnMiss` config defaults to `true` — disabling allows thundering herd on cache miss
- `renderTimeout` only applies to foreground render; background uses 2× the timeout
- `stripCdnCache()` in `utils.ts` ensures split browser/CDN lifecycle by adding `private, no-cache`
- `safeKey()` in `keys.ts` uses djb2 hash for paths >480 bytes to stay within Cache API URL limits
- `resolveStorage()` has runtime `never` checks to enforce discriminated union — can't mix bindings + custom storage
