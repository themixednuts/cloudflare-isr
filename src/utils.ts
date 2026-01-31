import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheLayerResult,
  Logger,
  RenderResult,
  RevalidateValue,
  RouteConfig,
} from "./types.ts";
import type { TagIndex } from "./revalidation/tag-index.ts";
import { logWarn } from "./logger.ts";

export const DEFAULT_REVALIDATE = 60;

/**
 * Convert a render result (which may be a raw Response) to a RenderResult.
 */
export async function toRenderResult(
  input: RenderResult | Response,
): Promise<RenderResult> {
  if (!(input instanceof Response)) {
    return input;
  }
  const body = await input.text();
  const headers: Record<string, string> = {};
  for (const [key, value] of input.headers.entries()) {
    headers[key] = value;
  }
  return { body, status: input.status, headers };
}

export function sanitizeHeaders(
  headers: Readonly<Record<string, string>>,
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

export function normalizeTags(tags: readonly string[] | undefined): string[] {
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
): "HIT" | "STALE" {
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

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const needle = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === needle);
}

export function applyCacheControl(
  headers: Readonly<Record<string, string>>,
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
}): CacheEntryMetadata {
  const { result, routeConfig, revalidateSeconds, now } = options;
  return {
    createdAt: now,
    revalidateAfter: revalidateAfter(revalidateSeconds, now),
    status: result.status,
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
  const headers = applyCacheControl(
    options.result.headers ?? {},
    options.revalidateSeconds,
    options.logger,
  );
  return { body: options.result.body, headers, metadata };
}

export async function updateTagIndexSafely(options: {
  tagIndex: TagIndex;
  tags: readonly string[];
  key: string;
  logger?: Logger;
  context?: string;
}): Promise<void> {
  const { tagIndex, tags, key, logger, context } = options;
  if (tags.length === 0) return;
  try {
    await tagIndex.addKeyToTags(tags, key);
  } catch (error) {
    const message = context ?? "Failed to update tag index:";
    logWarn(logger, message, error);
  }
}
