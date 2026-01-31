# cloudflare-isr

> [!WARNING]
> This project is a work in progress. APIs are unstable and will change without notice.

Framework-agnostic Incremental Static Regeneration (ISR) for Cloudflare Workers.

Serve pages from cache, revalidate in the background, and purge by path or tag — using KV, Cache API, and Durable Objects.

## Features

- **Two-tier caching** — L1 Cache API (per-colo, fast) backed by L2 KV (global, consistent)
- **Stale-while-revalidate** — serve stale content instantly while refreshing in the background
- **Tag-based invalidation** — purge groups of pages with `revalidateTag("blog")`
- **Path revalidation** — purge a single page with `revalidatePath("/blog/my-post")`
- **Route matching** — exact, param (`:slug` / `[slug]`), catch-all (`[...rest]`), wildcard (`*`)
- **Framework-agnostic** — works with SvelteKit, Nuxt, SolidStart, or any Cloudflare Worker
- **Bypass / draft mode** — skip cache with a secret token for content previews

## Quick start

```ts
import { createISR, renderer } from "cloudflare-isr";

const isr = createISR({
  kv: env.ISR_CACHE,
  tagIndex: env.TAG_INDEX,
  routes: {
    "/": { revalidate: 60, tags: ["home"] },
    "/blog/[slug]": { revalidate: 120, tags: ["blog"] },
  },
  render: renderer(),
});

// In your request handler / middleware:
const response = await isr.handleRequest(request, ctx);
if (response) return response;
// ...fall through to framework
```

## How it works

1. `handleRequest` checks if the request matches a configured route
2. On **cache hit**, the cached response is returned immediately
3. On **stale**, the stale response is returned and a background revalidation is kicked off via `ctx.waitUntil`
4. On **miss**, the `render` function is called synchronously and the result is cached
5. `renderer()` creates a self-fetch render function with a recursion guard header (`X-ISR-Rendering`) so the framework handles the actual rendering

## Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `ISR_CACHE` | KV Namespace | Stores cached page responses |
| `TAG_INDEX` | Durable Object | Maps cache tags to cache keys (SQLite-backed) |

The library ships `ISRTagIndexDO` — re-export it from your worker entry point and configure migrations in `wrangler.jsonc`.

## API

### `createISR(options)`

Creates an ISR instance. Two modes:

**Shorthand** — pass Cloudflare bindings directly:
```ts
createISR({ kv, tagIndex, render, routes })
```

**Advanced** — pass a custom storage implementation:
```ts
createISR({ storage: { cache, tagIndex, lock }, render, routes })
```

Returns an `ISRInstance` with:
- `handleRequest(request, ctx)` — returns `Response | null`
- `revalidatePath(path)` — purge a single path
- `revalidateTag(tag)` — purge all paths with a given tag

### `renderer(init?)`

Creates a render function that self-fetches with a recursion guard header. This is the recommended approach for middleware-based integrations.

```ts
renderer({ headers: { "X-Custom": "value" } })
```

### `ISRTagIndexDO`

Durable Object class for the tag-to-key reverse index. Must be re-exported from your worker and declared in `wrangler.jsonc`.

## Framework examples

See [`examples/`](./examples/) for working integrations:

- **SvelteKit** — `hooks.server.ts` with `handle`
- **Nuxt** — Nitro plugin wrapping the app handler
- **SolidStart** — Vinxi middleware

## License

MIT
