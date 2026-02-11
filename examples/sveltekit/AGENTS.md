# SVELTEKIT EXAMPLE KNOWLEDGE BASE

## OVERVIEW

SvelteKit adapter reference app with nested route precedence checks and Playwright ISR verification.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Attach ISR to request lifecycle | `src/hooks.server.ts` | `export const handle = isr()` |
| Page-level ISR config | `src/routes/+page.server.ts` | `locals.isr.set({ revalidate, tags })` |
| Nested default/override flow | `src/routes/nested/+layout.server.ts` | use `locals.isr.defaults(...)`, avoid legacy config races |
| Child override behavior | `src/routes/nested/override/+page.server.ts` | confirms page-level precedence |
| Explicit opt-out behavior | `src/routes/nested/optout/+page.server.ts` | `revalidate: 0` skip-cache path |
| On-demand revalidation endpoint | `src/routes/api/revalidate/+server.ts` | bearer secret + constant-time compare |
| Browser validation | `e2e/isr.test.ts` | header/status and revalidation flow checks |
| Nested precedence validation | `e2e/nested.test.ts` | layout defaults, override, opt-out assertions |

## CONVENTIONS

- Route config is request-scoped through `locals.isr`; do not export stale static route config objects.
- Use `locals.isr.defaults()` in layouts and `locals.isr.set()` in pages for explicit precedence.
- Keep revalidation endpoint response shape stable (`{ ok: true, revalidated: ... }`) for test parity.
- `wrangler dev` must run with workers DO config (`-c wrangler.jsonc -c ../workers/wrangler.jsonc`).

## ANTI-PATTERNS

- Do not use plain equality for `REVALIDATION_SECRET`; use constant-time compare.
- Do not rely on old `locals.isrRouteConfig` pattern; async layout/page loads can race.
- Do not run this example without the shared workers config; DO binding resolution fails.
- Do not assume lowercase/uppercase ISR header casing in browser checks; use case-insensitive fetch header APIs.
