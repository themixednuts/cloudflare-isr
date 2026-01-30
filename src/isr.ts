import type {
  CacheEntry,
  CacheStatus,
  ISROptions,
  ISRInstance,
  Logger,
  RenderResult,
} from "./types.ts";
import { isBypass } from "./bypass.ts";
import { matchRoute } from "./route-matcher.ts";
import { createRevalidator, revalidate } from "./revalidation/revalidator.ts";
import { logError, logWarn } from "./logger.ts";
import {
  createCacheEntry,
  isForever,
  isNoStore,
  resolveRevalidate,
  safeCacheGet,
  sanitizeHeaders,
  updateTagIndexSafely,
} from "./utils.ts";

/**
 * Build an HTTP Response from a CacheEntry and a cache status label.
 */
function buildCachedResponse(
  entry: CacheEntry,
  status: CacheStatus,
  logger?: Logger,
): Response {
  const headers = new Headers(sanitizeHeaders(entry.metadata.headers, logger));
  headers.set("X-ISR-Status", status);
  headers.set("X-ISR-Cache-Date", new Date(entry.metadata.createdAt).toUTCString());

  return new Response(entry.body, {
    status: entry.metadata.status,
    headers,
  });
}

/**
 * Create an ISR instance.
 */
export function createISR(options: ISROptions): ISRInstance {
  const logger = options.logger;
  const cache = options.storage.cache;
  const tagIndex = options.storage.tagIndex;
  const cacheKey = options.cacheKey ?? ((url: URL) => url.pathname);
  const defaultRevalidate = resolveRevalidate({
    defaultValue: options.defaultRevalidate,
  });
  const revalidator = createRevalidator({
    storage: options.storage,
    cacheKey,
    logger,
  });

  function buildRenderResponse(
    result: RenderResult,
    status: CacheStatus,
    setNoStore = false,
  ): Response {
    const headers = new Headers(sanitizeHeaders(result.headers ?? {}, logger));
    headers.set("X-ISR-Status", status);
    if (setNoStore) {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(result.body, {
      status: result.status,
      headers,
    });
  }

  return {
    async handleRequest(
      request: Request,
      ctx: ExecutionContext,
    ): Promise<Response> {
      // Only GET and HEAD are cacheable.
      if (request.method !== "GET" && request.method !== "HEAD") {
        const result = await options.render(request);
        return buildRenderResponse(result, "SKIP", true);
      }

      const url = new URL(request.url);
      const pathname = url.pathname;
      const key = cacheKey(url);

      const routeMatch = options.routes ? matchRoute(pathname, options.routes) : null;
      const routeConfig = routeMatch?.config;
      const allowCache = options.routes ? routeMatch !== null : true;

      // Bypass mode — render fresh, skip cache entirely.
      if (isBypass(request, options.bypassToken)) {
        const result = await options.render(request);
        return buildRenderResponse(result, "BYPASS", true);
      }

      if (!allowCache) {
        const result = await options.render(request);
        return buildRenderResponse(result, "SKIP", true);
      }

      const routeRevalidate = resolveRevalidate({
        route: routeConfig?.revalidate,
        defaultValue: defaultRevalidate,
      });

      if (isNoStore(routeRevalidate)) {
        const result = await options.render(request);
        ctx.waitUntil(
          cache.delete(key).catch((error) => {
            logWarn(logger, "Failed to delete cache entry:", error);
          }),
        );
        return buildRenderResponse(result, "SKIP", true);
      }

      const cached = await safeCacheGet({ get: () => cache.get(key), logger });

      // HIT — serve directly from cache.
      if (cached.status === "HIT" && cached.entry) {
        return buildCachedResponse(cached.entry, "HIT", logger);
      }

      // STALE — serve stale response immediately, revalidate in the background.
      if (cached.status === "STALE" && cached.entry) {
        if (isForever(routeRevalidate)) {
          return buildCachedResponse(cached.entry, "HIT", logger);
        }
        ctx.waitUntil(
          revalidate({
            key,
            request,
            lock: options.storage.lock,
            tagIndex,
            cache,
            render: options.render,
            defaultRevalidate,
            routeConfig,
            logger,
          }).catch((error) => {
            logWarn(logger, "Background revalidation failed:", error);
          }),
        );
        return buildCachedResponse(cached.entry, "STALE", logger);
      }

      // MISS — render synchronously (blocking).
      const result = await options.render(request);

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
        return buildRenderResponse(result, "SKIP", true);
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
          await cache.put(key, entry);
          await updateTagIndexSafely({
            tagIndex,
            tags: entry.metadata.tags,
            key,
            logger,
          });
        })().catch((error) => {
          logError(logger, "Failed to persist cache entry:", error);
        }),
      );

      return buildCachedResponse(entry, "MISS", logger);
    },
    revalidatePath: revalidator.revalidatePath,
    revalidateTag: revalidator.revalidateTag,
  };
}
