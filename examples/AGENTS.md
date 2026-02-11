# EXAMPLES KNOWLEDGE BASE

**Generated:** 2026-02-11

## OVERVIEW

Full working ISR apps per framework (monorepo workspaces), integration tests, shared DO binding via workers/.

## STRUCTURE

```
examples/
├── sveltekit/
│   ├── src/hooks.server.ts              # Adapter integration via handle hook
│   ├── src/routes/**/+page.server.ts    # Per-route config via locals.isr.set/defaults
│   ├── src/routes/nested/+layout.server.ts  # Layout defaults + child override precedence
│   ├── e2e/                             # Playwright tests (isr.test.ts, nested.test.ts)
│   ├── AGENTS.md                        # SvelteKit-specific conventions and gotchas
│   └── wrangler.jsonc                   # Merges workers/ DO config
├── nuxt/
│   ├── server/plugins/isr.ts            # Adapter setup, global route map
│   ├── server/api/revalidate.post.ts    # Bearer token auth
│   └── wrangler.jsonc
├── solidstart/
│   ├── src/middleware.ts                # Adapter via createMiddleware, route map
│   └── wrangler.jsonc
├── workers/
│   ├── src/index.ts                     # Exports only ISRTagIndexDO
│   └── wrangler.jsonc                   # Shared KV, R2, DO bindings
└── isr-tests.ts                         # Cross-framework integration runner (plain fetch)
```

## WHERE TO LOOK

| Task | File(s) | Notes |
|------|---------|-------|
| SvelteKit ISR setup | `sveltekit/src/hooks.server.ts` | `handle` hook pattern |
| SvelteKit per-route config | `sveltekit/src/routes/**/+page.server.ts` | use `locals.isr.set()` / `locals.isr.defaults()` |
| SvelteKit nested layout config | `sveltekit/src/routes/nested/+layout.server.ts` | tests config precedence and race safety |
| Nuxt ISR setup | `nuxt/server/plugins/isr.ts` | Global route map in plugin |
| SolidStart ISR setup | `solidstart/src/middleware.ts` | `createMiddleware` factory |
| Revalidation endpoint pattern | `*/api/revalidate*` in each example | Bearer token auth |
| Playwright e2e tests | `sveltekit/e2e/` | `isr.test.ts`, `nested.test.ts` |
| Cross-framework integration | `isr-tests.ts` | Validates MISS/HIT, tags, timestamps |
| Shared DO binding config | `workers/wrangler.jsonc` | Multi-config pattern |

## NOTES

- Run example: `cd examples/sveltekit && bun run cf:dev` (builds library, Wrangler port 8899)
- Integration tests: `bun run examples/isr-tests.ts http://localhost:8899` (any running example)
- E2E tests: `cd examples/sveltekit && bun run test:e2e` (requires `cf:dev` running)
- All examples use `"cloudflare-isr": "file:../../"` — local library link
- Each example merges `workers/wrangler.jsonc` for shared DO/KV/R2 bindings via multi-config
- Nuxt endpoint also accepts batched `{ paths?, tags? }`; SvelteKit/SolidStart are singular path/tag
- Revalidation endpoints must use constant-time secret checks (no direct string compare)
- `workers/` only exports `ISRTagIndexDO` — pure DO host shared across examples
- Integration test (`isr-tests.ts`) validates framework-agnostic behavior via raw HTTP
