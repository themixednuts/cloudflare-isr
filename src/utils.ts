import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheLayerResult,
  CacheLayerStatus,
  Logger,
  RenderResult,
  RevalidateValue,
  RouteConfig,
} from "./types.ts";
import type { TagIndex } from "./revalidation/tag-index.ts";
import { logWarn } from "./logger.ts";

export const DEFAULT_REVALIDATE = 60;

export function sanitizeHeaders(
  headers: Record<string, string>,
  logger?: Logger,
): Record<string, string> {
  const safe = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    try {
      safe.set(key, value);
    } catch (error) {
      logWarn(logger, `Dropping invalid header "${key}":`, error);
    }
  }
  return Object.fromEntries(safe.entries());
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

export function resolveRevalidate(options: {
  render?: RevalidateValue;
  route?: RevalidateValue;
  defaultValue?: RevalidateValue;
}): RevalidateValue {
  if (options.render !== undefined) {
    return options.render;
  }

  if (options.route !== undefined) {
    return options.route;
  }

  return options.defaultValue ?? DEFAULT_REVALIDATE;
}

export function isNoStore(value: RevalidateValue): boolean {
  return typeof value === "number" && value <= 0;
}

export function isForever(value: RevalidateValue): value is false {
  return value === false;
}

export function revalidateAfter(value: RevalidateValue, now: number): number | null {
  if (isForever(value)) {
    return null;
  }

  return now + value * 1000;
}

export function determineCacheStatus(
  revalidateAfterValue: number | null,
  now: number,
): CacheLayerStatus {
  return revalidateAfterValue === null || now < revalidateAfterValue ? "HIT" : "STALE";
}

export async function safeCacheGet(options: {
  get: () => Promise<CacheLayerResult>;
  logger?: Logger;
  label?: string;
}): Promise<CacheLayerResult> {
  try {
    return await options.get();
  } catch (error) {
    const message = options.label
      ? `Failed to read ${options.label} cache:`
      : "Cache read failed:";
    logWarn(options.logger, message, error);
    return { entry: null, status: "MISS" };
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === needle);
}

export function applyCacheControl(
  headers: Record<string, string>,
  revalidateSeconds: RevalidateValue,
  logger?: Logger,
): Record<string, string> {
  const safeHeaders = sanitizeHeaders(headers, logger);
  if (hasHeader(safeHeaders, "cache-control")) {
    return safeHeaders;
  }

  if (revalidateSeconds === false) {
    return {
      ...safeHeaders,
      "Cache-Control": "public, max-age=0, s-maxage=31536000, immutable",
    };
  }

  const ttl = Math.max(0, Math.floor(revalidateSeconds));
  return {
    ...safeHeaders,
    "Cache-Control": `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
  };
}

export function createCacheEntryMetadata(options: {
  result: RenderResult;
  routeConfig?: RouteConfig;
  revalidateSeconds: RevalidateValue;
  now: number;
  logger?: Logger;
}): CacheEntryMetadata {
  const { result, routeConfig, revalidateSeconds, now, logger } = options;
  const responseHeaders = applyCacheControl(
    result.headers ?? {},
    revalidateSeconds,
    logger,
  );
  return {
    createdAt: now,
    revalidateAfter: revalidateAfter(revalidateSeconds, now),
    status: result.status,
    headers: responseHeaders,
    tags: normalizeTags(result.tags ?? routeConfig?.tags),
  };
}

export function createCacheEntry(options: {
  result: RenderResult;
  routeConfig?: RouteConfig;
  revalidateSeconds: RevalidateValue;
  now: number;
  logger?: Logger;
}): CacheEntry {
  const metadata = createCacheEntryMetadata(options);
  return { body: options.result.body, metadata };
}

export async function updateTagIndexSafely(options: {
  tagIndex: TagIndex;
  tags: string[];
  key: string;
  logger?: Logger;
  context?: string;
}): Promise<void> {
  const { tagIndex, tags, key, logger, context } = options;
  if (tags.length === 0) return;
  const results = await Promise.allSettled(tags.map((tag) => tagIndex.addKeyToTag(tag, key)));
  const message = context ?? "Failed to update tag index:";
  for (const result of results) {
    if (result.status === "rejected") {
      logWarn(logger, message, result.reason);
    }
  }
}
