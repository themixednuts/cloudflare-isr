import type {
  CacheKeyFunction,
  CacheLayer,
  ISRStorage,
  LockProvider,
  Logger,
  RenderFunction,
  RouteConfig,
} from "../types.ts";
import type { TagIndex } from "./tag-index.ts";
import { logError, logWarn } from "../logger.ts";
import {
  createCacheEntry,
  isNoStore,
  resolveRevalidate,
  updateTagIndexSafely,
} from "../utils.ts";

/**
 * Perform a background revalidation for the given cache key.
 *
 * Acquires a distributed lock so that only one worker revalidates a path at
 * a time. On success the fresh render result is written to the cache and the
 * tag-to-key index is updated. On failure the last-known-good cache entry is
 * preserved and the error is logged.
 */
export async function revalidate(options: {
  key: string;
  request: Request;
  lock?: LockProvider;
  tagIndex: TagIndex;
  cache: CacheLayer;
  render: RenderFunction;
  defaultRevalidate?: RouteConfig["revalidate"];
  routeConfig?: RouteConfig;
  logger?: Logger;
}): Promise<void> {
  const {
    key,
    request,
    lock,
    tagIndex,
    cache,
    render,
    defaultRevalidate,
    routeConfig,
    logger,
  } = options;

  if (lock) {
    const locked = await lock.acquire(key);
    if (!locked) {
      return;
    }
  }

  try {
    const result = await render(request);

    const revalidateSeconds = resolveRevalidate({
      render: result.revalidate,
      route: routeConfig?.revalidate,
      defaultValue: defaultRevalidate,
    });

    if (isNoStore(revalidateSeconds)) {
      await cache.delete(key);
      return;
    }

    const now = Date.now();

    const entry = createCacheEntry({
      result,
      routeConfig,
      revalidateSeconds,
      now,
      logger,
    });

    await cache.put(key, entry);

    await updateTagIndexSafely({
      tagIndex,
      tags: entry.metadata.tags,
      key,
      logger,
      context: "Failed to update tag index during revalidation:",
    });
  } catch (error) {
    // Keep last-known-good cache entry — do not delete.
    logError(logger, `Background revalidation failed for "${key}":`, error);
  } finally {
    if (lock) {
      await lock.release(key);
    }
  }
}

export interface Revalidator {
  revalidatePath(path: string | URL): Promise<void>;
  revalidateTag(tag: string): Promise<void>;
}

const MAX_PARALLEL_INVALIDATIONS = 25;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  logger?: Logger,
): Promise<void> {
  if (items.length === 0) return;
  const queue = items.slice();
  const errors: unknown[] = [];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift() as T;
        try {
          await fn(item);
        } catch (error) {
          errors.push(error);
        }
      }
    },
  );
  await Promise.all(workers);
  if (errors.length > 0) {
    logWarn(logger, `${errors.length} invalidation errors occurred.`);
  }
}

export function createRevalidator(options: {
  storage: ISRStorage;
  cacheKey?: CacheKeyFunction;
  logger?: Logger;
}): Revalidator {
  const cacheKey = options.cacheKey ?? ((url: URL) => url.pathname);
  const logger = options.logger;

  function keyFromPath(input: string | URL): string {
    if (typeof input === "string") {
      return cacheKey(new URL(input, "https://isr.internal"));
    }

    return cacheKey(input);
  }

  return {
    async revalidatePath(path: string | URL): Promise<void> {
      await options.storage.cache.delete(keyFromPath(path));
    },
    async revalidateTag(tag: string): Promise<void> {
      const keys = await options.storage.tagIndex.getKeysByTag(tag);
      await runWithConcurrency(
        keys,
        MAX_PARALLEL_INVALIDATIONS,
        async (key) => {
          await options.storage.cache.delete(key);
          await options.storage.tagIndex.removeKeyFromTag(tag, key);
        },
        logger,
      );
    },
  };
}
