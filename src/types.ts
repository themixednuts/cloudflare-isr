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

/** Revalidation behavior for a cached response (seconds, 0 = no store, false = forever). */
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

/** The public API surface returned by `createISR()`. */
export interface ISRInstance {
  /**
   * Main request handler. Returns a cached or freshly-rendered response for
   * GET/HEAD requests that match configured routes. Returns `null` for
   * requests that ISR does not handle (non-GET methods, non-matching routes),
   * allowing the framework to handle them normally.
   *
   * @param request - The incoming HTTP request.
   * @param ctx     - The Cloudflare Workers execution context (for `waitUntil`).
   * @returns A fully formed HTTP response, or `null` if ISR doesn't handle this request.
   */
  handleRequest(request: Request, ctx: ExecutionContext): Promise<Response | null>;

  /**
   * Programmatically revalidate (purge) a specific path.
   * The next request will re-render and cache the result.
   *
   * @param path - The URL path or URL to revalidate (e.g. `"/blog/my-post"`).
   */
  revalidatePath(path: string | URL): Promise<void>;

  /**
   * Invalidate all cached entries associated with the given tag.
   *
   * @param tag - The cache tag to invalidate (e.g. `"blog"`).
   */
  revalidateTag(tag: string): Promise<void>;
}
