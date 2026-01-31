import type {
  CacheEntry,
  CacheStatus,
  ISROptions,
  ISRInstance,
  ISRStorage,
  Logger,
  RenderResult,
} from "./types.ts";
import { isBypass } from "./bypass.ts";
import { ISR_RENDER_HEADER } from "./render.ts";
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
  toRenderResult,
  updateTagIndexSafely,
} from "./utils.ts";
import { createWorkersStorage } from "./storage/workers.ts";
import { TagIndexDOClient } from "./revalidation/tag-index.ts";

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

/**
 * Build an HTTP Response from a body/status/headers shape and a cache status label.
 */
function buildResponse(
  source: CacheEntry | RenderResult,
  cacheStatus: CacheStatus,
  logger?: Logger,
  noStore = false,
): Response {
  const isCacheEntry = "metadata" in source;
  const body = source.body;
  const status = isCacheEntry ? source.metadata.status : source.status;
  const rawHeaders = isCacheEntry ? source.headers : (source.headers ?? {});

  const headers = new Headers(sanitizeHeaders(rawHeaders, logger));
  headers.set("X-ISR-Status", cacheStatus);

  if (isCacheEntry) {
    headers.set("X-ISR-Cache-Date", new Date(source.metadata.createdAt).toUTCString());
  }
  if (noStore) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(body, { status, headers });
}

/**
 * Create an ISR instance.
 */
export function createISR(options: ISROptions): ISRInstance {
  const logger = options.logger;
  const storage = resolveStorage(options);
  const cache = storage.cache;
  const tagIndex = storage.tagIndex;
  const cacheKey = options.cacheKey ?? ((url: URL) => url.pathname);
  const defaultRevalidate = resolveRevalidate({
    defaultValue: options.defaultRevalidate,
  });
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

  return {
    async handleRequest(
      request: Request,
      ctx: ExecutionContext,
    ): Promise<Response | null> {
      // Only GET and HEAD are cacheable — return null for everything else
      // so the framework can handle the request normally.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return null;
      }

      // Recursion guard: selfFetch() render requests carry this header.
      // Return null so the framework renders the page normally.
      if (request.headers.get(ISR_RENDER_HEADER) === "1") {
        return null;
      }

      const url = new URL(request.url);
      const pathname = url.pathname;
      const key = cacheKey(url);

      const routeMatch = options.routes ? matchRoute(pathname, options.routes) : null;
      const routeConfig = routeMatch?.config;
      const allowCache = options.routes ? routeMatch !== null : true;

      // Non-matching route — return null so the framework handles it.
      if (!allowCache) {
        return null;
      }

      const render = ensureRender();

      // Bypass mode — render fresh, skip cache entirely.
      if (isBypass(request, options.bypassToken)) {
        const result = await toRenderResult(await render(request));
        return buildResponse(result, "BYPASS", logger, true);
      }

      const routeRevalidate = resolveRevalidate({
        route: routeConfig?.revalidate,
        defaultValue: defaultRevalidate,
      });

      if (isNoStore(routeRevalidate)) {
        const result = await toRenderResult(await render(request));
        ctx.waitUntil(
          cache.delete(key).catch((error) => {
            logWarn(logger, "Failed to delete cache entry:", error);
          }),
        );
        return buildResponse(result, "SKIP", logger, true);
      }

      const cached = await safeCacheGet({ get: () => cache.get(key), logger });

      // HIT — serve directly from cache.
      if (cached.status === "HIT" && cached.entry) {
        return buildResponse(cached.entry, "HIT", logger);
      }

      // STALE — serve stale response immediately, revalidate in the background.
      if (cached.status === "STALE" && cached.entry) {
        if (isForever(routeRevalidate)) {
          return buildResponse(cached.entry, "HIT", logger);
        }
        ctx.waitUntil(
          revalidate({
            key,
            request,
            lock: storage.lock,
            tagIndex,
            cache,
            render,
            defaultRevalidate,
            routeConfig,
            logger,
          }).catch((error) => {
            logWarn(logger, "Background revalidation failed:", error);
          }),
        );
        return buildResponse(cached.entry, "STALE", logger);
      }

      // MISS — render synchronously (blocking).
      const result = await toRenderResult(await render(request));

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
        return buildResponse(result, "SKIP", logger, true);
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

      return buildResponse(entry, "MISS", logger);
    },
    revalidatePath: revalidator.revalidatePath,
    revalidateTag: revalidator.revalidateTag,
  };
}
