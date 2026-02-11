/**
 * Core type definitions for the cloudflare-isr library.
 *
 * A framework-agnostic Incremental Static Regeneration (ISR) engine
 * for Cloudflare Workers using KV + Cache API.
 *
 * Cloudflare Workers global types (KVNamespace, ExecutionContext) are
 * provided by @cloudflare/workers-types.
 */

import type { TagIndex } from "./revalidation/tag-index.ts";

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Controls how long a cached response is considered fresh.
 *
 * - **Positive number**: TTL in seconds before the entry goes stale.
 * - **`0`**: Do not cache (no-store). The response is never written to cache.
 * - **`false`**: Cache forever (immutable). The entry never goes stale.
 * - **`undefined`**: Inherit from the next config layer (route > default > 60s).
 *
 * @example
 * ```ts
 * // Cache for 5 minutes
 * { revalidate: 300 }
 *
 * // Never cache (dynamic page)
 * { revalidate: 0 }
 *
 * // Cache forever (static asset)
 * { revalidate: false }
 * ```
 */
export type RevalidateValue = number | false;

/** Result of rendering a page. */
export interface RenderResult {
  /** The rendered HTML (or other body content). */
  body: string;
  /** HTTP status code for the response. */
  status: number;
  /** HTTP response headers to include. */
  headers?: Readonly<Record<string, string>>;
  /** Optional tags for tag-based cache invalidation. */
  tags?: readonly string[];
  /** Per-page TTL override in seconds. Use 0 to skip caching, false for forever. */
  revalidate?: RevalidateValue;
}

/** Async function that renders a page for a given request. */
export type RenderFunction = (request: Request) => Promise<RenderResult | Response>;

// ---------------------------------------------------------------------------
// Route configuration
// ---------------------------------------------------------------------------

/** Per-route ISR configuration. */
export interface RouteConfig {
  /** Time-to-live in seconds before the cached entry is considered stale. */
  revalidate?: RevalidateValue;
  /** Tags associated with this route for tag-based invalidation. */
  tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// ISR options
// ---------------------------------------------------------------------------

/** Options accepted by `createISR()`. */
export interface ISRStorage {
  /** Cache layer used to store rendered responses. */
  cache: CacheLayer;
  /** Tag-to-cache-keys reverse index implementation. */
  tagIndex: TagIndex;
  /** Optional lock provider for background revalidation. */
  lock?: LockProvider;
}

export interface LockProvider {
  acquire(key: string): Promise<AsyncDisposable | null>;
}

/** Function that maps a URL to a cache key (path + optional query). */
export type CacheKeyFunction = (url: URL) => string;

export interface Logger {
  /** Optional prefix for log messages (default: "[ISR]"). */
  prefix?: string;
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/** Common options shared by both shorthand and advanced ISR configurations. */
interface ISROptionsBase {
  /** Optional logger hook for warnings and errors. */
  logger?: Logger;
  /** Default TTL in seconds applied when no per-route override is set. */
  defaultRevalidate?: RevalidateValue;
  /** Secret token that enables draft / bypass mode when provided in a request. */
  bypassToken?: string;
  /**
   * Maximum milliseconds to wait for the render function before aborting.
   * Background revalidation uses `2x` this value to allow more time.
   * If a timeout occurs during foreground rendering and a stale cache entry
   * exists, the stale entry is served instead.
   *
   * @default 25000
   *
   * @example
   * ```ts
   * createISR({ renderTimeout: 10000, ... }) // 10s foreground, 20s background
   * ```
   */
  renderTimeout?: number;
  /**
   * Acquire a lock on cache MISS to prevent multiple workers from rendering
   * the same page simultaneously. When a lock cannot be acquired (another
   * worker is already rendering), `handleRequest` returns `null` so the
   * framework can handle the request directly without caching.
   *
   * @default true
   *
   * @example
   * ```ts
   * createISR({ lockOnMiss: false, ... }) // disable lock on MISS
   * ```
   */
  lockOnMiss?: boolean;
  /**
   * Whether to expose `X-ISR-Status` and `X-ISR-Cache-Date` response headers.
   * Set to `false` in production to hide cache internals from end users.
   *
   * @default true
   */
  exposeHeaders?: boolean;
  /**
   * Predicate to determine if a response with the given status code should
   * be cached. Return `false` to skip caching (the response is still returned
   * to the client, just not stored).
   *
   * @default `(status) => status < 500 && status !== 204` — caches everything
   * except 5xx server errors and 204 No Content (which has no body and would
   * replace real page content with an empty response for all visitors).
   *
   * @see CVE-2025-49826 -- empty-body response cached as page content (DoS)
   *
   * @example
   * ```ts
   * // Only cache successful responses
   * shouldCacheStatus: (status) => status >= 200 && status < 300
   * ```
   */
  shouldCacheStatus?: (status: number) => boolean;
  /**
   * Function responsible for rendering a page on cache miss or revalidation.
   *
   * Can return a `RenderResult` object or a raw `Response` (which will be
   * consumed automatically). Use `renderer()` for the common middleware
   * pattern.
   *
   * Optional when only using `revalidatePath` / `revalidateTag` (e.g. in a
   * dedicated revalidation API endpoint). If omitted, `handleRequest` will
   * throw when it encounters a cache miss.
   */
  render?: RenderFunction;
  /** Optional cache key function. Defaults to `url.pathname`. */
  cacheKey?: CacheKeyFunction;
  /**
   * Route-specific ISR configuration keyed by path patterns.
   * When provided, only matching routes are cached — non-matching
   * requests return `null` from `handleRequest`.
   *
   * Supported pattern syntax:
   * - Exact:        `/about`
   * - Param:        `/blog/:slug` or `/blog/[slug]`
   * - Catch-all:    `/docs/[...rest]`
   * - Wildcard:     `/products/*`
   *
   * @example
   * ```ts
   * routes: {
   *   "/blog/*": { revalidate: 60, tags: ["blog"] },
   *   "/products/:id": { revalidate: 300, tags: ["products"] },
   * }
   * ```
   */
  routes?: Readonly<Record<string, RouteConfig>>;
}

/**
 * Shorthand: provide Cloudflare bindings directly. The library creates
 * the two-tier cache (Cache API + KV) and tag index client automatically.
 *
 * @example
 * ```ts
 * const isr = createISR({
 *   kv: env.ISR_CACHE,
 *   tagIndex: env.TAG_INDEX,
 *   render: renderer(),
 *   routes: { "/blog/*": { revalidate: 60, tags: ["blog"] } },
 * });
 * ```
 */
interface ISROptionsWithBindings extends ISROptionsBase {
  /** KV namespace used for cache storage. */
  kv: KVNamespace;
  /** Durable Object namespace for the tag index. */
  tagIndex: DurableObjectNamespace;
  /** Cache API namespace (default: "isr"). */
  cacheName?: string;
  /** Not allowed when using bindings directly. */
  storage?: never;
}

/**
 * Advanced: provide a custom `ISRStorage` implementation.
 *
 * @example
 * ```ts
 * const isr = createISR({
 *   storage: myCustomStorage,
 *   render: myRenderFn,
 * });
 * ```
 */
interface ISROptionsWithStorage extends ISROptionsBase {
  /** Full storage implementation (cache layer + tag index + optional lock). */
  storage: ISRStorage;
  /** Not allowed when using custom storage. */
  kv?: never;
  /** Not allowed when using custom storage. */
  tagIndex?: never;
  /** Not allowed when using custom storage. */
  cacheName?: never;
}

/** Options accepted by `createISR()`. */
export type ISROptions = ISROptionsWithBindings | ISROptionsWithStorage;

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

/**
 * Options accepted by framework adapter `handle()` functions.
 *
 * Adapters pass these through to `createISR()` internally, resolving
 * Cloudflare bindings from the framework's platform/environment context.
 */
export interface ISRAdapterOptions {
  /** Route-specific ISR configuration keyed by path patterns. */
  routes?: Readonly<Record<string, RouteConfig>>;
  /** Optional logger hook for warnings and errors. */
  logger?: Logger;
  /** Secret token that enables draft / bypass mode. */
  bypassToken?: string;
  /** Default TTL in seconds applied when no per-route override is set. */
  defaultRevalidate?: RevalidateValue;
  /** Maximum milliseconds to wait for render. */
  renderTimeout?: number;
  /** Whether to lock on cache MISS. */
  lockOnMiss?: boolean;
  /** Whether to expose `X-ISR-*` headers. */
  exposeHeaders?: boolean;
  /** Predicate deciding if a status should be cached. */
  shouldCacheStatus?: (status: number) => boolean;
  /** Optional cache key function. */
  cacheKey?: CacheKeyFunction;
  /** Cache API namespace (default: `"isr"`). */
  cacheName?: string;
  /** Custom render function override for adapter integrations. */
  render?: RenderFunction;
  /** Canonical trusted origin used for adapter request reconstruction. */
  trustedOrigin?: string;
  /** Optional host allowlist for adapter request reconstruction. */
  allowedHosts?: readonly string[];
  /** URL scheme used when reconstructing request URLs without trustedOrigin. */
  originProtocol?: "https" | "http";
  /** KV binding name (default: "ISR_CACHE"). */
  kvBinding?: string;
  /** Durable Object binding name (default: "TAG_INDEX"). */
  tagIndexBinding?: string;
}

// ---------------------------------------------------------------------------
// Cache entries
// ---------------------------------------------------------------------------

/**
 * Small metadata stored in KV metadata field (must stay under 1024 bytes).
 * Response headers are stored in the KV value to avoid exceeding the limit.
 */
export interface CacheEntryMetadata {
  /** Timestamp (ms since epoch) when the entry was created. */
  createdAt: number;
  /** Timestamp (ms since epoch) after which the entry is considered stale. */
  revalidateAfter: number | null;
  /** HTTP status code. */
  status: number;
  /** Cache tags for tag-based invalidation. */
  tags: readonly string[];
}

/** A full cache entry consisting of the response body and its metadata. */
export interface CacheEntry {
  /** The cached response body. */
  body: string;
  /** Response headers to include when serving from cache. */
  headers: Record<string, string>;
  /** Metadata describing the cache entry. */
  metadata: CacheEntryMetadata;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

/** Describes the cache status of a lookup. */
export type CacheLayerStatus = "HIT" | "STALE" | "MISS";

/** Describes the cache status of an ISR response. */
export type CacheStatus = CacheLayerStatus | "BYPASS" | "SKIP";

/** Result returned from a cache layer lookup (discriminated on `status`). */
export type CacheLayerResult =
  | { /** The cached entry. */ entry: CacheEntry; /** Cache hit — entry is fresh. */ status: "HIT" }
  | { /** The cached entry. */ entry: CacheEntry; /** Cache stale — entry exists but TTL has passed. */ status: "STALE" }
  | { /** No entry found. */ entry: null; /** Cache miss — no entry for this key. */ status: "MISS" };

/** Abstract cache layer interface implemented by L1 (Cache API) and L2 (KV). */
export interface CacheLayer {
  get(path: string): Promise<CacheLayerResult>;
  put(path: string, entry: CacheEntry): Promise<void>;
  delete(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ISR instance
// ---------------------------------------------------------------------------

/** Options accepted by `handleRequest()`. */
export interface HandleRequestOptions<
  TRequest extends Request = Request,
  TCtx extends ExecutionContext = ExecutionContext,
> {
  /** The incoming HTTP request. */
  request: TRequest;
  /** The Cloudflare Workers execution context (for `waitUntil`). */
  ctx: TCtx;
  /** Optional per-request route config. */
  routeConfig?: RouteConfig;
}

/** Options accepted by `lookup()`. */
export interface LookupOptions<
  TRequest extends Request = Request,
  TCtx extends ExecutionContext = ExecutionContext,
> {
  /** The incoming HTTP request. */
  request: TRequest;
  /** Optional execution context for background revalidation. */
  ctx?: TCtx;
}

/** Options accepted by `cache()`. */
export interface CacheResponseOptions<
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TCtx extends ExecutionContext = ExecutionContext,
> {
  /** The original request (used to derive the cache key). */
  request: TRequest;
  /** The framework-rendered response to cache (body will be consumed). */
  response: TResponse;
  /** The route's ISR configuration. */
  routeConfig: RouteConfig;
  /** Execution context for async cache writes via `waitUntil`. */
  ctx: TCtx;
}

/** Options accepted by `cache()` when response parts are already available. */
export interface CacheBodyOptions<
  TRequest extends Request = Request,
  TCtx extends ExecutionContext = ExecutionContext,
> {
  /** The original request (used to derive the cache key). */
  request: TRequest;
  /** Response status code from the framework render pipeline. */
  status: number;
  /** Rendered response body. */
  body: string;
  /** Optional response headers. */
  headers?: Headers | Readonly<Record<string, string>>;
  /** The route's ISR configuration. */
  routeConfig: RouteConfig;
  /** Execution context for async cache writes via `waitUntil`. */
  ctx: TCtx;
}

export type CacheOptions<
  TRequest extends Request = Request,
  TResponse extends Response = Response,
  TCtx extends ExecutionContext = ExecutionContext,
> =
  | CacheResponseOptions<TRequest, TResponse, TCtx>
  | CacheBodyOptions<TRequest, TCtx>;

/** Options accepted by `revalidatePath()`. */
export interface RevalidatePathOptions {
  /** The URL path or URL to revalidate (e.g. `"/blog/my-post"`). */
  path: string | URL;
}

/** Options accepted by `revalidateTag()`. */
export interface RevalidateTagOptions {
  /** The cache tag to invalidate (e.g. `"blog"`). */
  tag: string;
}

/** Options accepted by `scope()`. */
export interface ScopeOptions<TRequest extends Request = Request> {
  /** Optional request used to match the global routes map. */
  request?: TRequest;
}

/**
 * Per-request ISR scope with config builder methods.
 *
 * Created via `isr.scope()` in middleware — gives load functions a
 * concurrency-safe way to configure ISR without direct assignment races.
 *
 * Layout loads call `defaults()` and page loads call `set()`.
 * `set()` always wins over `defaults()` for scalar values (revalidate),
 * while tags are merged from both.
 */
export interface ISRRequestScope extends ISRInstance {
  /**
   * Set default ISR config for this request. Intended for use in layouts
   * or shared middleware. Values are overridden by `set()` if called.
   * Tags from both `defaults()` and `set()` are merged.
   */
  defaults(config: RouteConfig): void;

  /**
   * Set authoritative ISR config for this request. Intended for use in
   * page-level load functions. Always wins over `defaults()` for scalar
   * values (`revalidate`). Tags are merged with any `defaults()` tags.
   */
  set(config: RouteConfig): void;

  /**
   * Resolve the merged route config from all config sources.
   * Returns `null` if no config was found (route did not opt into ISR).
   *
   * Config sources (in priority order, highest wins for `revalidate`):
   * 1. Global `routes` map (from `createISR()`) — base layer
   * 2. `defaults()` calls — overrides global route config
   * 3. `set()` calls — overrides everything
   *
   * Tags are merged (unioned) across all layers.
   *
   * @example
   * ```ts
   * // Layout sets defaults, page overrides revalidate, tags merge:
   * isr.defaults({ revalidate: 300, tags: ["layout"] });
   * isr.set({ revalidate: 60, tags: ["page"] });
   * isr.resolveConfig();
   * // => { revalidate: 60, tags: ["layout", "page"] }
   *
   * // No config set — returns null (route did not opt in):
   * isr.resolveConfig();
   * // => null
   * ```
   */
  resolveConfig(): RouteConfig | null;
}

/** The public API surface returned by `createISR()`. */
export interface ISRInstance {
  /**
   * Main request handler. Returns a cached or freshly-rendered response for
   * GET/HEAD requests that match configured routes. Returns `null` for
   * requests that ISR does not handle (non-GET methods, non-matching routes),
   * allowing the framework to handle them normally.
   *
   * When `routeConfig` is provided, the request is treated as an ISR route
   * using that config — bypassing the static `routes` map entirely. This
   * allows frameworks to pass per-route config collected from route files
   * (e.g. SvelteKit's `+page.server.ts`) at request time.
   *
 * @param options - `{ request, ctx, routeConfig }`.
   * @returns A fully formed HTTP response, or `null` if ISR doesn't handle this request.
   */
  handleRequest<
    TRequest extends Request = Request,
    TCtx extends ExecutionContext = ExecutionContext,
  >(options: HandleRequestOptions<TRequest, TCtx>): Promise<Response | null>;

  /**
   * Check the cache for a stored response without rendering.
   *
   * Returns the cached response with ISR headers (`X-ISR-Status`, etc.),
   * or `null` on cache miss. Use this as the first half of a split
   * lifecycle where the framework controls rendering.
   *
   * When `ctx` is provided and a `render` function was configured,
   * stale entries automatically trigger background revalidation via
   * `ctx.waitUntil`.
   *
 * @param options - `{ request, ctx }`.
   * @returns A cached response, or `null` if not in cache.
   */
  lookup<
    TRequest extends Request = Request,
    TCtx extends ExecutionContext = ExecutionContext,
  >(options: LookupOptions<TRequest, TCtx>): Promise<Response | null>;

  /**
   * Store a framework-rendered response in the ISR cache.
   *
   * Use this as the second half of a split lifecycle — after the framework
   * has rendered the page and the route handler has provided its config.
   *
   * Returns a new `Response` with ISR headers attached (`X-ISR-Status: MISS`,
   * `Cache-Control`, `X-ISR-Cache-Date`). The original response body is
   * consumed.
   *
 * @param options - `{ request, response, routeConfig, ctx }`.
   * @returns A new response with ISR headers.
   */
  cache<
    TRequest extends Request = Request,
    TResponse extends Response = Response,
    TCtx extends ExecutionContext = ExecutionContext,
  >(options: CacheOptions<TRequest, TResponse, TCtx>): Promise<Response>;

  /**
   * Programmatically revalidate (purge) a specific path.
   * The next request will re-render and cache the result.
   *
   * @param options - `{ path }`.
   */
  revalidatePath(options: RevalidatePathOptions): Promise<void>;

  /**
   * Invalidate all cached entries associated with the given tag.
   *
   * @param options - `{ tag }`.
   */
  revalidateTag(options: RevalidateTagOptions): Promise<void>;

  /**
   * Create a per-request scope with config builder methods.
   *
   * Use this in middleware/hooks to create a request-scoped ISR object
   * that load functions can safely call `defaults()` and `set()` on,
   * even when running concurrently.
   *
   * @param options - `{ request }` used for matching against the global `routes`
   *                  map. When provided, `resolveConfig()` falls back to the
   *                  matching route config if no `defaults()`/`set()` calls
   *                  were made, and merges global route tags with per-request tags.
   *
   * @example
   * ```ts
   * // In hook/middleware:
   * const scoped = isr.scope({ request });
   * event.locals.isr = scoped;
   *
 * const cached = await scoped.lookup({ request, ctx });
   * if (cached) return cached;
   *
   * const response = await resolve(event);
   * const config = scoped.resolveConfig();
 * if (config) return scoped.cache({ request, response, routeConfig: config, ctx });
   * return response;
   * ```
   */
  scope<TRequest extends Request = Request>(options?: ScopeOptions<TRequest>): ISRRequestScope;
}
