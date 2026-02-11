import type {
  CacheBodyOptions,
  CacheEntry,
  CacheStatus,
  CacheOptions,
  HandleRequestOptions,
  ISROptions,
  ISRInstance,
  ISRRequestScope,
  ISRStorage,
  LookupOptions,
  Logger,
  ScopeOptions,
  RenderResult,
  RouteConfig,
} from "./types.ts";
import { isBypass } from "./bypass.ts";
import { ISR_RENDER_HEADER } from "./render.ts";
import { matchRoute } from "./route-matcher.ts";
import { createRevalidator, revalidate } from "./revalidation/revalidator.ts";
import { logDebug, logError, logWarn } from "./logger.ts";
import {
  createCacheEntry,
  isForever,
  isNoStore,
  resolveRevalidate,
  safeCacheGet,
  toRenderResult,
  updateTagIndexSafely,
} from "./utils.ts";
import { createWorkersStorage } from "./storage/workers.ts";
import { TagIndexDOClient } from "./revalidation/tag-index.ts";
import { defaultCacheKey } from "./keys.ts";

const DEFAULT_RENDER_TIMEOUT = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0 || !Number.isFinite(ms)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[ISR] ${label} (${ms}ms)`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function resolveStorage(options: ISROptions): ISRStorage {
  if ("kv" in options && options.kv) {
    const tagIndex = new TagIndexDOClient(options.tagIndex);
    return createWorkersStorage({
      kv: options.kv,
      tagIndex,
      cacheName: options.cacheName,
      logger: options.logger,
    });
  }
  return (options as { storage: ISRStorage }).storage;
}

function isCacheEntry(source: CacheEntry | RenderResult): source is CacheEntry {
  return "metadata" in source && typeof (source as CacheEntry).metadata === "object" && (source as CacheEntry).metadata !== null && "createdAt" in (source as CacheEntry).metadata;
}

/**
 * Build an HTTP Response from a body/status/headers shape and a cache status label.
 */
function buildResponse(
  source: CacheEntry | RenderResult,
  cacheStatus: CacheStatus,
  logger?: Logger,
  opts?: { noStore?: boolean; exposeHeaders?: boolean },
): Response {
  const cached = isCacheEntry(source);
  const body = source.body;
  const status = cached ? source.metadata.status : source.status;
  const rawHeaders = cached ? source.headers : (source.headers ?? {});

  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    try {
      headers.set(key, value);
    } catch (error) {
      logWarn(logger, `Dropping invalid header "${key}":`, error);
    }
  }
  const expose = opts?.exposeHeaders !== false;

  if (expose) {
    headers.set("X-ISR-Status", cacheStatus);
    if (cached) {
      headers.set("X-ISR-Cache-Date", new Date(source.metadata.createdAt).toUTCString());
    }
  }

  if (opts?.noStore) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(body, { status, headers });
}

/**
 * Strip s-maxage from a response so the CDN does not cache it.
 * Used by the split lifecycle (lookup / cache) to ensure every request
 * reaches the worker and ISR can make caching decisions.
 */
function stripCdnCache(response: Response): Response {
  // "private" prevents shared caches (CDN, adapter-cloudflare's worktop cache)
  // from storing the response. "no-cache" tells browsers to always revalidate.
  // This ensures every request reaches the worker so lookup() can run.
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}

/**
 * Create an ISR instance.
 */
export function createISR(options: ISROptions): ISRInstance {
  // Runtime guard: TypeScript `never` types prevent mixing at compile time,
  // but JS callers could pass both. Catch it early with a clear message.
  if ("kv" in options && options.kv && "storage" in options && options.storage) {
    throw new Error(
      "[ISR] Cannot mix shorthand (kv, tagIndex) and advanced (storage) config. Choose one.",
    );
  }

  const logger = options.logger;
  const storage = resolveStorage(options);
  const cache = storage.cache;
  const tagIndex = storage.tagIndex;
  const cacheKey = options.cacheKey ?? defaultCacheKey;
  const defaultRevalidate = resolveRevalidate({
    defaultValue: options.defaultRevalidate,
  });
  const renderTimeout = options.renderTimeout ?? DEFAULT_RENDER_TIMEOUT;
  const lockOnMiss = options.lockOnMiss !== false;
  const exposeHeaders = options.exposeHeaders !== false;
  /**
   * Default: cache everything except 5xx and 204 No Content.
   * 204 responses have no body; caching them replaces real page content
   * with an empty response for all subsequent visitors (DoS).
   *
   * @see CVE-2025-49826 -- empty-body response cached as page content
   */
  const shouldCacheStatus = options.shouldCacheStatus ?? ((status: number) => status < 500 && status !== 204);

  /**
   * Per-instance nonce for the recursion guard header.
   * External clients cannot guess this value, preventing ISR bypass.
   *
   * @see CVE-2024-46982 -- Next.js internal header spoofed to poison cache
   * @see CVE-2025-29927 -- Next.js middleware bypass via spoofed x-middleware-subrequest
   */
  const renderNonce = crypto.randomUUID();

  const renderRequest = {
    wrap(request: Request): Request {
      const headers = new Headers(request.headers);
      headers.set(ISR_RENDER_HEADER, renderNonce);
      return new Request(request.url, { headers });
    },
    isRender(request: Request): boolean {
      return request.headers.get(ISR_RENDER_HEADER) === renderNonce;
    },
  };

  const revalidator = createRevalidator({
    storage,
    cacheKey,
    logger,
  });

  function ensureRender(): NonNullable<ISROptions["render"]> {
    if (!options.render) {
      throw new Error(
        "[ISR] No render function provided. Pass `render` to createISR() " +
        "when using handleRequest.",
      );
    }
    return options.render;
  }

  const instance: ISRInstance = {
    async handleRequest(requestOptions: HandleRequestOptions): Promise<Response | null> {
      const { request, ctx, routeConfig: inlineRouteConfig } = requestOptions;
      // Only GET and HEAD are cacheable — return null for everything else
      // so the framework can handle the request normally.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return null;
      }

      // Recursion guard: selfFetch() render requests carry the per-instance nonce.
      // Return null so the framework renders the page normally.
      if (renderRequest.isRender(request)) {
        return null;
      }

      const url = new URL(request.url);
      const pathname = url.pathname;
      const key = cacheKey(url);

      // When inline route config is provided, the route opts in directly —
      // skip the static routes map entirely.
      let routeConfig: RouteConfig | undefined;
      if (inlineRouteConfig) {
        routeConfig = inlineRouteConfig;
      } else {
        const routeMatch = options.routes ? matchRoute(pathname, options.routes) : null;
        routeConfig = routeMatch?.config;
        const allowCache = options.routes ? routeMatch !== null : true;

        // Non-matching route — return null so the framework handles it.
        if (!allowCache) {
          return null;
        }
      }

      const render = ensureRender();

      // Bypass mode — render fresh, skip cache entirely.
      if (isBypass(request, options.bypassToken)) {
        const result = await toRenderResult(
          await withTimeout(render(renderRequest.wrap(request)), renderTimeout, "Render timeout"),
        );
        return buildResponse(result, "BYPASS", logger, { noStore: true, exposeHeaders });
      }

      const routeRevalidate = resolveRevalidate({
        route: routeConfig?.revalidate,
        defaultValue: defaultRevalidate,
      });

      if (isNoStore(routeRevalidate)) {
        const result = await toRenderResult(
          await withTimeout(render(renderRequest.wrap(request)), renderTimeout, "Render timeout"),
        );
        ctx.waitUntil(
          cache.delete(key).catch((error) => {
            logWarn(logger, "Failed to delete cache entry:", error);
          }),
        );
        return buildResponse(result, "SKIP", logger, { noStore: true, exposeHeaders });
      }

      const cached = await safeCacheGet({ get: () => cache.get(key), logger });

      // HIT — serve directly from cache.
      if (cached.status === "HIT" && cached.entry) {
        return buildResponse(cached.entry, "HIT", logger, { exposeHeaders });
      }

      // STALE — serve stale response immediately, revalidate in the background.
      if (cached.status === "STALE" && cached.entry) {
        if (isForever(routeRevalidate)) {
          return buildResponse(cached.entry, "HIT", logger, { exposeHeaders });
        }
        ctx.waitUntil(
          revalidate({
            key,
            request,
            lock: storage.lock,
            tagIndex,
            cache,
            render: (req) => render(renderRequest.wrap(req)),
            defaultRevalidate,
            routeConfig,
            logger,
            renderTimeout: 2 * renderTimeout,
          }).catch((error) => {
            logWarn(logger, "Background revalidation failed:", error);
          }),
        );
        return buildResponse(cached.entry, "STALE", logger, { exposeHeaders });
      }

      // MISS — acquire lock to prevent thundering herd, then render.
      if (lockOnMiss && storage.lock) {
        const handle = await storage.lock.acquire(key);
        if (!handle) {
          // Another worker is rendering this path — fall through to framework.
          return null;
        }
        // Release the lock when the request finishes (including background work).
        ctx.waitUntil(
          (async () => { await handle[Symbol.asyncDispose](); })().catch(() => {}),
        );
      }

      const result = await toRenderResult(
        await withTimeout(render(renderRequest.wrap(request)), renderTimeout, "Render timeout"),
      );

      const revalidateSeconds = resolveRevalidate({
        render: result.revalidate,
        route: routeConfig?.revalidate,
        defaultValue: defaultRevalidate,
      });

      if (isNoStore(revalidateSeconds)) {
        ctx.waitUntil(
          cache.delete(key).catch((error) => {
            logWarn(logger, "Failed to delete cache entry:", error);
          }),
        );
        return buildResponse(result, "SKIP", logger, { noStore: true, exposeHeaders });
      }

      // Check if the response status is cacheable
      if (!shouldCacheStatus(result.status)) {
        logDebug(logger, "Skipping cache for status", result.status, "on", key);
        return buildResponse(result, "MISS", logger, { exposeHeaders });
      }

      const now = Date.now();

      const entry = createCacheEntry({
        result,
        routeConfig,
        revalidateSeconds,
        now,
        logger,
      });

      ctx.waitUntil(
        (async () => {
          await Promise.all([
            cache.put(key, entry),
            updateTagIndexSafely({
              tagIndex,
              tags: entry.metadata.tags,
              key,
              logger,
            }),
          ]);
        })().catch((error) => {
          logError(logger, "Failed to persist cache entry:", error);
        }),
      );

      return buildResponse(entry, "MISS", logger, { exposeHeaders });
    },
    async lookup(lookupOptions: LookupOptions): Promise<Response | null> {
      const { request, ctx } = lookupOptions;
      if (request.method !== "GET" && request.method !== "HEAD") {
        logDebug(logger, "lookup: skipping non-GET/HEAD method", request.method);
        return null;
      }

      if (renderRequest.isRender(request)) {
        logDebug(logger, "lookup: skipping render request (recursion guard)");
        return null;
      }

      const url = new URL(request.url);
      const key = cacheKey(url);

      // Bypass mode — render fresh if render function is available.
      if (isBypass(request, options.bypassToken)) {
        logDebug(logger, "lookup: bypass token detected for", key);
        if (options.render) {
          const result = await toRenderResult(
            await withTimeout(options.render(renderRequest.wrap(request)), renderTimeout, "Render timeout"),
          );
          return buildResponse(result, "BYPASS", logger, { noStore: true, exposeHeaders });
        }
        return null;
      }

      const cached = await safeCacheGet({ get: () => cache.get(key), logger });

      if (cached.status === "HIT" && cached.entry) {
        logDebug(logger, "lookup: HIT for", key);
        return stripCdnCache(buildResponse(cached.entry, "HIT", logger, { exposeHeaders }));
      }

      if (cached.status === "STALE" && cached.entry) {
        logDebug(logger, "lookup: STALE for", key);

        // Schedule background revalidation if we have both ctx and render
        if (ctx && options.render) {
          const routeConfig: RouteConfig = {
            revalidate: cached.entry.metadata.revalidateAfter !== null
              ? Math.max(0, Math.round((cached.entry.metadata.revalidateAfter - cached.entry.metadata.createdAt) / 1000))
              : false,
            tags: cached.entry.metadata.tags.length > 0
              ? cached.entry.metadata.tags
              : undefined,
          };
          ctx.waitUntil(
            revalidate({
              key,
              request,
              lock: storage.lock,
              tagIndex,
              cache,
              render: (req) => options.render!(renderRequest.wrap(req)),
              defaultRevalidate,
              routeConfig,
              logger,
              renderTimeout: 2 * renderTimeout,
            }).catch((error) => {
              logWarn(logger, "lookup: background revalidation failed:", error);
            }),
          );
        }

        return stripCdnCache(buildResponse(cached.entry, "STALE", logger, { exposeHeaders }));
      }

      logDebug(logger, "lookup: MISS for", key);
      return null;
    },

    async cache(cacheOptions: CacheOptions): Promise<Response> {
      const { request, routeConfig, ctx } = cacheOptions;
      const url = new URL(request.url);
      const key = cacheKey(url);

      const revalidateSeconds = resolveRevalidate({
        route: routeConfig.revalidate,
        defaultValue: defaultRevalidate,
      });

      // No-store: don't cache, clean up any existing entry
      if (isNoStore(revalidateSeconds)) {
        logDebug(logger, "cache: SKIP (revalidate ≤ 0) for", key);
        ctx.waitUntil(
          cache.delete(key).catch((error) => {
            logWarn(logger, "cache: failed to delete entry:", error);
          }),
        );
        // Return the original response with ISR headers
        const headers = new Headers(
          "response" in cacheOptions
            ? cacheOptions.response.headers
            : cacheOptions.headers,
        );
        if (exposeHeaders) {
          headers.set("X-ISR-Status", "SKIP");
        }
        headers.set("Cache-Control", "no-store");
        return new Response("response" in cacheOptions ? cacheOptions.response.body : cacheOptions.body, {
          status: "response" in cacheOptions ? cacheOptions.response.status : cacheOptions.status,
          headers,
        });
      }

      // Check if the response status is cacheable
      const responseStatus = "response" in cacheOptions ? cacheOptions.response.status : cacheOptions.status;
      if (!shouldCacheStatus(responseStatus)) {
        logDebug(logger, "cache: skipping cache for status", responseStatus, "on", key);
        const headers = new Headers(
          "response" in cacheOptions
            ? cacheOptions.response.headers
            : cacheOptions.headers,
        );
        if (exposeHeaders) {
          headers.set("X-ISR-Status", "MISS");
        }
        return new Response("response" in cacheOptions ? cacheOptions.response.body : cacheOptions.body, {
          status: responseStatus,
          headers,
        });
      }

      let body: string;
      let responseHeaders: Record<string, string>;
      if ("response" in cacheOptions) {
        body = await cacheOptions.response.text();
        responseHeaders = {};
        for (const [k, v] of cacheOptions.response.headers.entries()) {
          responseHeaders[k] = v;
        }
      } else {
        const bodyOptions = cacheOptions as CacheBodyOptions;
        body = bodyOptions.body;
        responseHeaders = {};
        if (bodyOptions.headers instanceof Headers) {
          for (const [k, v] of bodyOptions.headers.entries()) {
            responseHeaders[k] = v;
          }
        } else if (bodyOptions.headers) {
          for (const [k, v] of Object.entries(bodyOptions.headers)) {
            responseHeaders[k] = v;
          }
        }
      }

      const result: RenderResult = {
        body,
        status: responseStatus,
        headers: responseHeaders,
        tags: routeConfig.tags as string[] | undefined,
      };

      const now = Date.now();

      const entry = createCacheEntry({
        result,
        routeConfig,
        revalidateSeconds,
        now,
        logger,
      });

      logDebug(logger, "cache: storing entry for", key, "revalidate:", revalidateSeconds);

      ctx.waitUntil(
        (async () => {
          await Promise.all([
            cache.put(key, entry),
            updateTagIndexSafely({
              tagIndex,
              tags: entry.metadata.tags,
              key,
              logger,
            }),
          ]);
        })().catch((error) => {
          logError(logger, "cache: failed to persist entry:", error);
        }),
      );

      return stripCdnCache(buildResponse(entry, "MISS", logger, { exposeHeaders }));
    },

    revalidatePath: revalidator.revalidatePath,
    revalidateTag: revalidator.revalidateTag,

    scope(scopeOptions?: ScopeOptions): ISRRequestScope {
      const { request } = scopeOptions ?? {};
      let _defaults: RouteConfig | null = null;
      let _set: RouteConfig | null = null;

      // Match global routes map if a request was provided
      let _globalRoute: RouteConfig | null = null;
      if (request && options.routes) {
        const url = new URL(request.url);
        const match = matchRoute(url.pathname, options.routes);
        if (match) {
          _globalRoute = match.config;
        }
      }

      return {
        // Proxy ISRInstance methods through closure
        handleRequest: (options) => instance.handleRequest(options),
        lookup: (options) => instance.lookup(options),
        cache: (options) => instance.cache(options),
        revalidatePath: (options) => instance.revalidatePath(options),
        revalidateTag: (options) => instance.revalidateTag(options),
        scope: (options) => instance.scope(options),

        defaults(config: RouteConfig): void {
          _defaults = config;
        },

        set(config: RouteConfig): void {
          _set = config;
        },

        resolveConfig(): RouteConfig | null {
          // Merge three layers: global route → defaults → set
          // Higher layers override revalidate, tags union across all
          const layers = [_globalRoute, _defaults, _set].filter(
            (l): l is RouteConfig => l !== null,
          );

          if (layers.length === 0) return null;

          let revalidate: RouteConfig["revalidate"];
          const allTags: string[] = [];

          for (const layer of layers) {
            if (layer.revalidate !== undefined) {
              revalidate = layer.revalidate;
            }
            if (layer.tags) {
              allTags.push(...layer.tags);
            }
          }

          const uniqueTags = [...new Set(allTags)];

          return {
            revalidate,
            tags: uniqueTags.length > 0 ? uniqueTags : undefined,
          };
        },
      };
    },
  };

  return instance;
}
