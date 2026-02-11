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
const TEXT_ENCODER = new TextEncoder();

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

/**
 * Response headers that must never be stored in a shared cache.
 *
 * Caching Set-Cookie replays one user's session to all subsequent visitors,
 * enabling session hijacking and session fixation attacks.
 *
 * @see RFC 7234 Section 3 -- shared caches MUST NOT store Set-Cookie
 * @see Web Cache Deception (Black Hat 2024) -- cached auth headers enable account takeover
 */
export const responseHeaders = {
  UNCACHEABLE: ["set-cookie", "www-authenticate", "proxy-authenticate"] as const,
  strip(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!responseHeaders.UNCACHEABLE.includes(key.toLowerCase() as typeof responseHeaders.UNCACHEABLE[number])) {
        result[key] = value;
      }
    }
    return result;
  },
};

/**
 * Host header validation to prevent SSRF and cache poisoning.
 *
 * Untrusted Host values are used to construct URLs for self-fetch rendering.
 * A malicious Host (e.g., "evil.com") redirects the self-fetch to an
 * attacker-controlled server whose response gets cached permanently.
 *
 * @see CVE-2025-67647 -- SvelteKit SSRF via unchecked Host header
 * @see CWE-20 -- Improper Input Validation (Host header)
 */
export const host = {
  PATTERN: /^[a-zA-Z0-9._\-]+(:\d{1,5})?$/,
  sanitizeOrNull(raw: string, logger?: Logger): string | null {
    const trimmed = raw.trim();
    if (!host.PATTERN.test(trimmed)) {
      logWarn(logger, `Invalid Host header rejected: "${trimmed.slice(0, 64)}"`);
      return null;
    }
    return trimmed;
  },
  sanitize(raw: string, logger?: Logger): string {
    return host.sanitizeOrNull(raw, logger) ?? "localhost";
  },
  split(value: string): { hostname: string; port?: string } {
    const colonIndex = value.lastIndexOf(":");
    if (colonIndex === -1) {
      return { hostname: value.toLowerCase() };
    }
    const hostname = value.slice(0, colonIndex).toLowerCase();
    const port = value.slice(colonIndex + 1);
    return port ? { hostname, port } : { hostname };
  },
};

export interface ResolveOriginOptions {
  rawHost: string;
  logger?: Logger;
  protocol?: "https" | "http";
  trustedOrigin?: string;
  allowedHosts?: readonly string[];
}

export function resolveRequestOrigin(options: ResolveOriginOptions): string {
  const protocol = options.protocol ?? "https";

  if (options.trustedOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(options.trustedOrigin);
    } catch {
      throw new Error("[ISR] Invalid trustedOrigin; expected absolute URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("[ISR] trustedOrigin must use http or https protocol.");
    }
    return parsed.origin;
  }

  const sanitizedHost = host.sanitizeOrNull(options.rawHost, options.logger);
  if (!sanitizedHost) {
    throw new Error("[ISR] Invalid Host header.");
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const incoming = host.split(sanitizedHost);
    const match = options.allowedHosts.some((allowedRaw) => {
      const allowed = host.sanitizeOrNull(allowedRaw);
      if (!allowed) return false;
      const expected = host.split(allowed);
      if (expected.port) {
        return incoming.hostname === expected.hostname && incoming.port === expected.port;
      }
      return incoming.hostname === expected.hostname;
    });
    if (!match) {
      throw new Error("[ISR] Host header is not in allowedHosts.");
    }
  }

  return `${protocol}://${sanitizedHost}`;
}

/** Maximum number of tags allowed per cache entry. */
export const MAX_TAG_COUNT = 64;
/** Maximum character length of a single tag. */
export const MAX_TAG_LENGTH = 128;
/** Allowed characters in a tag: alphanumeric, hyphens, underscores, dots, colons, slashes. */
const TAG_PATTERN = /^[a-zA-Z0-9_\-.:\/]+$/;

export function validateTag(tag: string): void {
  if (tag.length === 0) {
    throw new Error("[ISR] Tag must not be empty.");
  }
  if (tag.length > MAX_TAG_LENGTH) {
    throw new Error(
      `[ISR] Tag exceeds maximum length of ${MAX_TAG_LENGTH} characters: "${tag.slice(0, 32)}..."`,
    );
  }
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(
      `[ISR] Tag contains invalid characters (allowed: a-z, A-Z, 0-9, _ - . : /): "${tag}"`,
    );
  }
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    validateTag(tag);
    seen.add(tag);
    normalized.push(tag);
  }
  if (normalized.length > MAX_TAG_COUNT) {
    throw new Error(
      `[ISR] Too many tags: ${normalized.length} exceeds maximum of ${MAX_TAG_COUNT}.`,
    );
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
  const safeHeaders = responseHeaders.strip(sanitizeHeaders(headers, logger));

  // ISR must always control Cache-Control. If the render function set one, warn and override it.
  if (hasHeader(safeHeaders, "cache-control")) {
    logWarn(
      logger,
      "Render response contained a Cache-Control header which was overridden by ISR.",
    );
    // Remove the original Cache-Control (case-insensitive)
    for (const key of Object.keys(safeHeaders)) {
      if (key.toLowerCase() === "cache-control") {
        delete safeHeaders[key];
      }
    }
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

/** Maximum bytes for KV metadata field. */
export const KV_METADATA_MAX_BYTES = 1024;

/**
 * Fit tags into the KV metadata size limit by greedily dropping trailing tags.
 * Returns the original array when it fits, or a truncated copy when it doesn't.
 */
export function fitMetadataTags(
  metadata: CacheEntryMetadata,
  logger?: Logger,
): readonly string[] {
  const serialized = JSON.stringify(metadata);
  const byteLength = TEXT_ENCODER.encode(serialized).byteLength;
  if (byteLength <= KV_METADATA_MAX_BYTES) {
    return metadata.tags;
  }

  const baseMeta: CacheEntryMetadata = { ...metadata, tags: [] };
  const baseBytes = TEXT_ENCODER.encode(JSON.stringify(baseMeta)).byteLength;
  if (baseBytes > KV_METADATA_MAX_BYTES) {
    logWarn(
      logger,
      `KV metadata base exceeds ${KV_METADATA_MAX_BYTES} bytes (${baseBytes}B), dropping all tags`,
    );
    return [];
  }

  const fittedTags: string[] = [];
  let currentBytes = baseBytes;
  for (const tag of metadata.tags) {
    const candidateMeta = { ...metadata, tags: [...fittedTags, tag] };
    const candidateBytes = TEXT_ENCODER.encode(JSON.stringify(candidateMeta)).byteLength;
    if (candidateBytes > KV_METADATA_MAX_BYTES) {
      break;
    }
    fittedTags.push(tag);
    currentBytes = candidateBytes;
  }

  logWarn(
    logger,
      `KV metadata exceeds ${KV_METADATA_MAX_BYTES} bytes (${byteLength}B), ` +
      `truncated tags from ${metadata.tags.length} to ${fittedTags.length} (${currentBytes}B)`,
  );

  return fittedTags;
}

/**
 * Runtime validation for deserialized cache entries.
 *
 * Cache API namespace collisions or corrupt storage could inject invalid
 * JSON that is trusted as a valid CacheEntry without validation.
 *
 * @see CWE-1287 -- Improper Validation of Specified Type of Input
 */
export const cacheEntry = {
  validate(parsed: unknown): CacheEntry | null {
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.body !== "string") return null;
    if (typeof p.metadata !== "object" || p.metadata === null) return null;
    const m = p.metadata as Record<string, unknown>;
    if (typeof m.createdAt !== "number") return null;
    if (p.headers !== undefined && (typeof p.headers !== "object" || Array.isArray(p.headers))) return null;
    return parsed as CacheEntry;
  },
};

export function createCacheEntryMetadata(options: {
  result: RenderResult;
  routeConfig?: RouteConfig;
  revalidateSeconds: RevalidateValue;
  now: number;
  logger?: Logger;
}): CacheEntryMetadata {
  const { result, routeConfig, revalidateSeconds, now, logger } = options;
  const rawTags = normalizeTags(result.tags ?? routeConfig?.tags);
  const metadata: CacheEntryMetadata = {
    createdAt: now,
    revalidateAfter: revalidateAfter(revalidateSeconds, now),
    status: result.status,
    tags: rawTags,
  };
  // Pre-truncate tags to fit KV metadata limit so tag index stays in sync.
  const fittedTags = fitMetadataTags(metadata, logger);
  if (fittedTags !== rawTags) {
    return { ...metadata, tags: fittedTags };
  }
  return metadata;
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
