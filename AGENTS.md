# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-07
**Commit:** 9b1ca0b
**Branch:** main

## OVERVIEW

Cloudflare Workers ISR (Incremental Static Regeneration) library. Two-tier cache (Cache API L1 + KV L2), tag-based invalidation via Durable Objects with SQLite, framework adapters for SvelteKit/Nuxt/SolidStart. Published to npm + JSR.

## STRUCTURE

```
cloudflare-isr/
├── src/
│   ├── adapters/        # Framework middleware (sveltekit, nuxt, solidstart)
│   ├── cache/           # Two-tier cache: L1 Cache API (per-colo) + L2 KV (global)
│   ├── revalidation/    # Tag index (DO + SQLite), distributed locks, background revalidator
│   ├── storage/         # Pluggable storage backend wiring (workers.ts)
│   ├── isr.ts           # Core ISR handler — createISR() factory, request lifecycle
│   ├── render.ts        # Self-fetch renderer factory + recursion guard header
│   ├── keys.ts          # Cache key generation with djb2 overflow hashing
│   ├── route-matcher.ts # URL pattern matching with compiled regex cache + validation
│   ├── bypass.ts        # Draft/preview bypass with constant-time token comparison
│   ├── types.ts         # All public types + ISROptions (configurable timeouts, locks, headers)
│   └── utils.ts         # Headers, tags, cache status, metadata size management
├── tests/               # Mirrors src/ structure exactly (16 files, 287 tests)
├── examples/            # Full working apps per framework (monorepo workspaces)
│   ├── sveltekit/       # Includes Playwright e2e tests
│   ├── nuxt/
│   ├── solidstart/
│   ├── workers/         # Raw Cloudflare Workers (hosts shared DO binding)
│   └── isr-tests.ts     # Cross-framework integration test runner
├── vite.config.ts       # Multi-entry library build (4 exports)
├── vitest.config.ts     # Cloudflare Workers pool testing
├── wrangler.jsonc       # KV, R2, Durable Object bindings for tests
└── cloudflare.d.ts      # Auto-generated Cloudflare types (~411KB, never hand-edit)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/modify ISR behavior | `src/isr.ts` | Core handler, configurable via `ISROptions` |
| Add framework adapter | `src/adapters/` | Follow handle() + ISRAdapterOptions pattern |
| Change cache strategy | `src/cache/` | L1/L2 layers compose in two-tier-cache |
| Tag invalidation logic | `src/revalidation/` | DO-backed SQLite reverse index |
| Custom storage backend | `src/storage/workers.ts` + `src/types.ts` | Implement `ISRStorage` interface |
| Public API types | `src/types.ts` | All exports, JSDoc-heavy, configurable options |
| Write tests | `tests/` matching `src/` path | Cloudflare Workers vitest pool |
| Integration tests | `examples/isr-tests.ts` | Bun script, hits running examples |
| E2E tests | `examples/sveltekit/e2e/` | Playwright |

## CONVENTIONS

- **Bun** for package management, **Vite** for build, **Vitest** for tests
- ESM only (`"type": "module"`) — `.ts` extensions in imports
- Tests run in Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`
- `createExecutionContext()` + `waitOnExecutionContext(ctx)` for testing background work
- Mock layers via factory functions (`makeMockLayer`, `makeRenderResult`, `makeFreshEntry`, `makeStaleEntry`)
- Multi-entry build: 4 export points (index, sveltekit, nuxt, solidstart)
- All `dependencies` + `peerDependencies` automatically externalized in Vite config
- TypeScript strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride`
- `wrangler types cloudflare.d.ts` regenerates Cloudflare bindings type file

## CONFIGURABLE OPTIONS (ISROptions)

| Option | Default | Purpose |
|--------|---------|---------|
| `renderTimeout` | 25000ms | Max render wait (background gets 2x) |
| `lockOnMiss` | `true` | Thundering herd protection on cache MISS |
| `exposeHeaders` | `true` | Toggle X-ISR-Status/X-ISR-Cache-Date headers |
| `shouldCacheStatus` | `status < 500` | Skip caching 5xx responses |
| `bypassToken` | — | Draft/preview mode secret |
| `defaultRevalidate` | 60s | Fallback TTL when no route config set |

## ANTI-PATTERNS

- **Never delete cache entries on revalidation failure** — keep last-known-good (revalidator.ts)
- **Never omit `X-ISR-Rendering` header in custom render functions** — causes infinite recursion (render.ts)
- **Never use Cache-Control without `no-cache`** — must reach worker every request (isr.ts)
- **Never throw on cache layer failures** — log warning, return MISS, continue (cache/, utils.ts)
- **Never mix shorthand (`kv`/`tagIndex`) and advanced (`storage`) config** — enforced by TypeScript `never` types + runtime guard
- **Locks are best-effort, not atomic** — two workers may revalidate simultaneously (harmless)
- **Never hand-edit cloudflare.d.ts** — regenerate with `bun run cf:types`

## COMMANDS

```bash
bun install              # Install dependencies
bun run build            # Build library (4 entry points)
bun run typecheck        # TypeScript check only
bun run test             # Unit tests (Cloudflare Workers pool, 287 tests)
bun run test:integration # E2E against running examples
bun run cf:types         # Regenerate cloudflare.d.ts
```

## NOTES

- Revalidate priority: `set()` > `defaults()` > global `routes` map; tags are merged (unioned)
- Only GET/HEAD requests are cacheable; all others return null
- `ISRTagIndexDO` must be exported from main entry for Wrangler discovery
- Publish workflow is manual dispatch only (`workflow_dispatch`), dual-publishes to npm + JSR
- KV keys >480 bytes auto-hashed via djb2 (`safeKey()` in keys.ts)
- KV metadata capped at 1024 bytes; tags truncated via `fitMetadataTags()` before both cache.put() and tag index
- Tag validation: max 64 tags, 128 chars each, alphanumeric + `_-.:/ `only
- Route patterns validated: no multiple catch-alls, max 512 chars
- Bypass token uses constant-time comparison (`safeEqual`)
- Examples are full monorepo workspaces with their own `wrangler.jsonc`
- `nul` file in root is a Windows artifact, safe to delete
