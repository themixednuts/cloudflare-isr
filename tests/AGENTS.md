# TESTS KNOWLEDGE BASE

## OVERVIEW

287 tests across 16 files. Mirrors `src/` structure. Runs in Cloudflare Workers runtime via vitest pool.

## STRUCTURE

```
tests/
├── isr.test.ts              # Core handler: lifecycle split, thundering herd, tag truncation desync
├── bypass.test.ts           # Draft mode token matching, constant-time comparison
├── keys.test.ts             # Cache key generation, djb2 overflow hashing
├── logger.test.ts           # Logger utility
├── render.test.ts           # Response normalization, recursion guard header
├── route-matcher.test.ts    # Pattern matching, validation, performance benchmarks
├── utils.test.ts            # Tag validation, metadata size limits
├── cache/
│   ├── l1-cache-api.test.ts    # L1 Cache API layer, TTL Math.ceil
│   ├── l2-kv.test.ts           # L2 KV layer, metadata truncation, JSON type guards
│   └── two-tier-cache.test.ts  # L1+L2 composition, fallthrough, backfill, error resilience
├── revalidation/
│   ├── lock.test.ts            # KV lock, AsyncDisposable, release failure safety
│   ├── revalidator.test.ts     # Background revalidation orchestration
│   ├── tag-index.test.ts       # Tag index client, assertOk error messages
│   └── tag-index-do.test.ts    # DO tag index, error isolation, SQL leak prevention
└── storage/
    ├── cloudflare.test.ts      # R2 CacheLayer, KV TagIndex swappable storage
    └── custom.test.ts          # Custom storage adapter interface
```

## CONVENTIONS

**Runtime:**
- `@cloudflare/vitest-pool-workers` — tests execute inside Workers runtime (miniflare)
- `import { env } from 'cloudflare:test'` for bindings (`env.ISR_CACHE`, `env.TAG_INDEX`, `env.R2_CACHE`)
- Cache API (`caches.open`) natively available, no polyfill needed

**Test Patterns:**
- `createExecutionContext()` + `waitOnExecutionContext(ctx)` to flush `ctx.waitUntil` background work
- Mock factories at top of file: `makeRenderResult()`, `makeMockLayer()`, `makeFreshEntry()`, `makeStaleEntry()` with `Partial<T>` overrides
- `beforeEach` cleanup: delete known `TEST_PATHS`/`TEST_TAGS` from KV, Cache API, R2, tag index
- Lock cleanup: explicit `await handle![Symbol.asyncDispose]()` (not `await using` in tests)
- Concurrent tests: `Promise.all([...])` with separate `createExecutionContext()` instances
- Force stale: `revalidate: 0.001` + `setTimeout(10ms)` for TTL expiry
- Render counting: `vi.fn()` + `mockImplementation` to assert exact call counts

**Behavioral Tests:**
- Thundering herd: verifies lock prevents duplicate renders
- Tag truncation desync: ensures L1/L2 tag sync despite KV metadata limits
- DO error isolation: validates no SQL keywords leak in error messages
- Cache resilience: error in one layer doesn't crash entire operation

## NOTES

- KV lock is best-effort in single-process miniflare; concurrent lock tests document this limitation
- Storage tests (`storage/`) prove any Cloudflare primitive (R2, KV) works via inline adapters
- Each test targets specific audit fix or edge case (see git blame for context)
- Bindings declared in `wrangler.jsonc`, referenced in `vitest.config.ts` via `defineWorkersConfig`
