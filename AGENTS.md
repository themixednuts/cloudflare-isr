# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-11
**Commit:** 5e59ba7
**Branch:** main

## OVERVIEW

Cloudflare Workers ISR library with two-tier caching (Cache API L1 + KV L2), tag invalidation through Durable Objects (SQLite), and first-party adapters for SvelteKit, Nuxt, and SolidStart. Published to npm + JSR from one TypeScript ESM codebase.

## STRUCTURE

```
cloudflare-isr/
├── src/                 # Core runtime + adapters + cache/revalidation internals
│   ├── AGENTS.md
│   ├── adapters/
│   ├── cache/
│   └── revalidation/
├── tests/               # Workers-runtime tests mirroring src concerns
├── examples/            # Framework workspaces + integration runner
│   ├── AGENTS.md
│   └── sveltekit/AGENTS.md
├── vite.config.ts       # Multi-entry build (index + 3 adapters)
├── vitest.config.ts     # Workers test pool config
├── wrangler.jsonc       # Test-worker bindings
└── cloudflare.d.ts      # Generated types (never hand-edit)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Core request lifecycle | `src/isr.ts` | bypass, cache lookup, render, store, background revalidate |
| Public API contracts | `src/types.ts` | option unions and adapter interfaces |
| Framework integration | `src/adapters/` | SvelteKit/Nuxt/SolidStart middleware wrappers |
| Cache behavior | `src/cache/` | L1/L2 layers, backfill, fail-soft handling |
| Tag invalidation | `src/revalidation/` | DO client/class, lock provider, purge orchestration |
| Workers runtime tests | `tests/` | `createExecutionContext` + waitUntil flushing patterns |
| Cross-framework behavior | `examples/isr-tests.ts` | MISS/HIT/revalidate parity checks |
| Browser-level e2e | `examples/sveltekit/e2e/` | Playwright checks for ISR headers and nested config |

## CODE MAP

| Symbol/Module | Type | Location | Refs | Role |
|---------------|------|----------|------|------|
| `createISR` | factory | `src/isr.ts` | high | runtime entry and ISR lifecycle orchestration |
| `types.ts` surface | contracts | `src/types.ts` | 25 | central contract hub used by src/tests/adapters |
| `TagIndex` | interface/client | `src/revalidation/tag-index.ts` | 12 | tag lookup and invalidation boundary |
| key utilities | functions | `src/keys.ts` | 11 | stable cache/lock key generation |
| shared utilities | functions | `src/utils.ts` | 9 | cache metadata fit, tag validation, header policy |
| adapter handles | integration | `src/adapters/*.ts` | medium | framework request/response bridge to core ISR |

## CONVENTIONS

- ESM-only (`"type": "module"`), TypeScript imports use explicit `.ts` extensions.
- Bun is the canonical package manager for root and workspaces.
- CI is publish-oriented (`workflow_dispatch`) and validates before npm/JSR release.
- Workers runtime is first-class in tests (`@cloudflare/vitest-pool-workers` + Wrangler bindings).
- Public package surface is intentionally narrow: root export + three adapter subpath exports.

## ANTI-PATTERNS (THIS PROJECT)

- Never delete cache entries on revalidation failure; keep last-known-good.
- Never omit `X-ISR-Rendering` from custom render paths.
- Never ship ISR cache-control without `no-cache`.
- Never throw hard on cache layer failures; log and degrade to MISS.
- Never mix shorthand (`kv`/`tagIndex`) and advanced (`storage`) config in one `createISR` call.
- Never hand-edit `cloudflare.d.ts`; regenerate with `bun run cf:types`.

## UNIQUE STYLES

- Config precedence is explicit: `set()` > `defaults()` > global `routes`, tags are unioned.
- Security checks use constant-time token comparison for bypass/revalidation endpoints.
- Background work is best-effort via guarded `ctx.waitUntil` flows.
- Example apps reuse one dedicated DO host worker through Wrangler multi-config.

## COMMANDS

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run test:integration
bun run cf:types
```

## NOTES

- Scale snapshot: 123 files, about 20.9k TS/Py/Go lines, max directory depth 6.
- Complexity-scored hierarchy: root plus `src/`, `examples/`, and `examples/sveltekit/` as primary domain docs.
- Existing focused docs remain in `src/cache/`, `src/revalidation/`, `src/adapters/`, and `tests/`.
- `dist/` is tracked build output; source of truth is `src/`.
