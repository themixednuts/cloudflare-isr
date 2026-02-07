# src/adapters/ — Framework Integration Layer

## OVERVIEW

Framework-specific middleware wrapping `createISR()` into SvelteKit/Nuxt/SolidStart's hook/plugin signatures.

## CODE MAP

**sveltekit.ts** (92 lines)
- `handle(opts?)` → SvelteKit `Handle`
- Bindings from `event.platform.env`
- Attaches `scoped` to `event.locals.isr`
- Three-phase: `lookup()` → `resolve(event)` → `cache()`

**nuxt.ts** (121 lines)
- `handle(opts?)` → `NitroAppPlugin`
- Monkey-patches `nitro.h3App.handler`
- Reconstructs `Request` from H3Event (`event.path` + `host` header)
- Converts Node.js response headers (`event.node.res.getHeaders()`) to `Response` for cache phase
- Uses `event.respondWith()` to short-circuit after cache hit/store

**solidstart.ts** (141 lines)
- `handle(opts?)` → `{ onRequest, onBeforeResponse }` for `createMiddleware()`
- Split lifecycle: `onRequest` does `lookup()`, `onBeforeResponse` does `cache()`
- Stashes `_isrRequest`/`_isrCtx` on `event.locals` between phases
- Extracts from `nativeEvent.context.cloudflare` (vinxi H3 event)

## CONVENTIONS

- `ISRAdapterOptions` imported from `../types.ts` (routes, logger, bypassToken, defaultRevalidate, kvBinding, tagIndexBinding)
- Singleton `ISRInstance` per adapter via module-level `let instance` + lazy `getISR()` helper
- Default bindings: `"ISR_CACHE"` (KV), `"TAG_INDEX"` (Durable Object), overridable via opts
- Binding validation in `getISR()` throws descriptive errors with wrangler.toml instructions
- Always pass `renderer()` from `../render.ts` as render function to `createISR()`
- Three-phase pattern: (1) `scoped.lookup()` cache check, (2) framework renders, (3) `scoped.cache()` if `resolveConfig()` non-null
- Cloudflare bindings location: `event.platform` (SvelteKit), `event.context.cloudflare` (Nuxt), `nativeEvent.context.cloudflare` (SolidStart)
- Missing bindings → immediate error with wrangler config snippet (never silent failure)
- ISRRequestScope exposed to route handlers via framework locals/context (`event.locals.isr`, `event.context.isr`)

## ADDING A NEW ADAPTER

1. Create `src/adapters/{framework}.ts`
2. Import `ISRAdapterOptions` from `../types.ts`
3. Define platform binding interface (env + context fields)
4. Implement `getISR(env, opts)` singleton with binding validation
5. Export `handle(opts = {})` returning framework's middleware type
6. Map framework event to Cloudflare `env`/`ExecutionContext`
7. Reconstruct `Request` if framework uses non-standard request format
8. Call `isr.scope(request)` and attach result to per-request locals/context
9. Three-phase: `lookup()` → framework render → `cache()` if `resolveConfig()` returns config
10. Add subpath export `./sveltekit`, `./nuxt`, `./solidstart` in root `package.json`
11. Add Vite entry in `vite.config.ts` build config (4 total: index + 3 adapters)
12. Add JSDoc example showing typical hooks file integration
