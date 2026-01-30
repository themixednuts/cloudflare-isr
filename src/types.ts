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

/** Common response shape shared by render and cache metadata. */
export interface ResponseShape {
  /** The rendered HTML (or other body content). */
  body: string;
  /** HTTP status code for the response. */
  status: number;
  /** HTTP response headers to include. */
  headers?: Record<string, string>;
  /** Optional tags for tag-based cache invalidation. */
  tags?: string[];
}

/** Result of rendering a page. */
export type RenderResult = ResponseShape & {
  /** Per-page TTL override in seconds. Use 0 to skip caching, false for forever. */
  revalidate?: RevalidateValue;
};

/** Async function that renders a page for a given request. */
export type RenderFunction = (request: Request) => Promise<RenderResult>;

// ---------------------------------------------------------------------------
// Route configuration
// ---------------------------------------------------------------------------

/** Per-route ISR configuration. */
export interface RouteConfig {
  /** Time-to-live in seconds before the cached entry is considered stale. */
  revalidate?: RevalidateValue;
  /** Tags associated with this route for tag-based invalidation. */
  tags?: string[];
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
  acquire(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
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

/** Options accepted by `createISR()`. */
export interface ISROptions {
  /** Storage implementation (cache + tag index). */
  storage: ISRStorage;
  /** Optional logger hook for warnings and errors. */
  logger?: Logger;
  /** Default TTL in seconds applied when no per-route override is set. */
  defaultRevalidate?: RevalidateValue;
  /** Secret token that enables draft / bypass mode when provided in a request. */
  bypassToken?: string;
  /** Function responsible for rendering a page on cache miss or revalidation. */
  render: RenderFunction;
  /** Optional cache key function. Defaults to `url.pathname`. */
  cacheKey?: CacheKeyFunction;
  /**
   * Route-specific ISR configuration keyed by path patterns.
   * When provided, only matching routes are cached.
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
  routes?: Record<string, RouteConfig>;
}

// ---------------------------------------------------------------------------
// Cache entries
// ---------------------------------------------------------------------------

/** Metadata stored alongside a cached page in KV. */
export type CacheEntryMetadata = {
  /** Timestamp (ms since epoch) when the entry was created. */
  createdAt: number;
  /** Timestamp (ms since epoch) after which the entry is considered stale. */
  revalidateAfter: number | null;
} & Required<Omit<ResponseShape, "body">>;

/** A full cache entry consisting of the response body and its metadata. */
export interface CacheEntry {
  /** The cached response body. */
  body: string;
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

/** Result returned from a cache layer lookup. */
export interface CacheLayerResult {
  /** The cache entry, or `null` when the lookup is a miss. */
  entry: CacheEntry | null;
  /** Indicates how the cache responded to the lookup. */
  status: CacheLayerStatus;
}

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
   * Main request handler. Serves cached content when available, triggers
   * background revalidation for stale entries, and renders on cache miss.
   *
   * @param request - The incoming HTTP request.
   * @param ctx     - The Cloudflare Workers execution context (for `waitUntil`).
   * @returns A fully formed HTTP response.
   */
  handleRequest(request: Request, ctx: ExecutionContext): Promise<Response>;

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
