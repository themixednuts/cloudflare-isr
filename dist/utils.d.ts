import { CacheEntry, CacheEntryMetadata, CacheLayerResult, Logger, RenderResult, RevalidateValue, RouteConfig } from './types.ts';
import { TagIndex } from './revalidation/tag-index.ts';
export declare const DEFAULT_REVALIDATE = 60;
/**
 * Convert a render result (which may be a raw Response) to a RenderResult.
 */
export declare function toRenderResult(input: RenderResult | Response): Promise<RenderResult>;
export declare function sanitizeHeaders(headers: Readonly<Record<string, string>>, logger?: Logger): Record<string, string>;
/**
 * Response headers that must never be stored in a shared cache.
 *
 * Caching Set-Cookie replays one user's session to all subsequent visitors,
 * enabling session hijacking and session fixation attacks.
 *
 * @see RFC 7234 Section 3 -- shared caches MUST NOT store Set-Cookie
 * @see Web Cache Deception (Black Hat 2024) -- cached auth headers enable account takeover
 */
export declare const responseHeaders: {
    UNCACHEABLE: readonly ["set-cookie", "www-authenticate", "proxy-authenticate"];
    strip(headers: Record<string, string>): Record<string, string>;
};
/**
 * Host header validation to prevent SSRF and cache poisoning.
 *
 * Untrusted Host values are used to construct URLs for self-fetch rendering.
 * A malicious Host (e.g., "evil.com") redirects the self-fetch to an
 * attacker-controlled server whose response gets cached permanently.
 *
 * @see CVE-2025-67647 -- SvelteKit SSRF via unchecked Host header
 * @see CVE-2025-12543 -- malformed Host validation bypass enables poisoning/SSRF
 * @see CWE-20 -- Improper Input Validation (Host header)
 */
export declare const host: {
    PATTERN: RegExp;
    sanitizeOrNull(raw: string, logger?: Logger): string | null;
    sanitize(raw: string, logger?: Logger): string;
    split(value: string): {
        hostname: string;
        port?: string;
    };
};
export interface ResolveOriginOptions {
    rawHost: string;
    logger?: Logger;
    protocol?: "https" | "http";
    trustedOrigin?: string;
    allowedHosts?: readonly string[];
}
export declare function resolveRequestOrigin(options: ResolveOriginOptions): string;
/** Maximum number of tags allowed per cache entry. */
export declare const MAX_TAG_COUNT = 64;
/** Maximum character length of a single tag. */
export declare const MAX_TAG_LENGTH = 128;
export declare function validateTag(tag: string): void;
export declare function normalizeTags(tags: readonly string[] | undefined): string[];
export declare function resolveRevalidate(options: {
    render?: RevalidateValue;
    route?: RevalidateValue;
    defaultValue?: RevalidateValue;
}): RevalidateValue;
export declare function isNoStore(value: RevalidateValue): boolean;
export declare function isForever(value: RevalidateValue): value is false;
export declare function revalidateAfter(value: RevalidateValue, now: number): number | null;
export declare function determineCacheStatus(revalidateAfterValue: number | null, now: number): "HIT" | "STALE";
export declare function safeCacheGet(options: {
    get: () => Promise<CacheLayerResult>;
    logger?: Logger;
    label?: string;
}): Promise<CacheLayerResult>;
export declare function applyCacheControl(headers: Readonly<Record<string, string>>, revalidateSeconds: RevalidateValue, logger?: Logger): Record<string, string>;
/** Maximum bytes for KV metadata field. */
export declare const KV_METADATA_MAX_BYTES = 1024;
/**
 * Fit tags into the KV metadata size limit by greedily dropping trailing tags.
 * Returns the original array when it fits, or a truncated copy when it doesn't.
 */
export declare function fitMetadataTags(metadata: CacheEntryMetadata, logger?: Logger): readonly string[];
/**
 * Runtime validation for deserialized cache entries.
 *
 * Cache API namespace collisions or corrupt storage could inject invalid
 * JSON that is trusted as a valid CacheEntry without validation.
 *
 * @see CWE-1287 -- Improper Validation of Specified Type of Input
 */
export declare const cacheEntry: {
    validate(parsed: unknown): CacheEntry | null;
};
export declare function createCacheEntryMetadata(options: {
    result: RenderResult;
    routeConfig?: RouteConfig;
    revalidateSeconds: RevalidateValue;
    now: number;
    logger?: Logger;
}): CacheEntryMetadata;
export declare function createCacheEntry(options: {
    result: RenderResult;
    routeConfig?: RouteConfig;
    revalidateSeconds: RevalidateValue;
    now: number;
    logger?: Logger;
}): CacheEntry;
export declare function updateTagIndexSafely(options: {
    tagIndex: TagIndex;
    tags: readonly string[];
    key: string;
    logger?: Logger;
    context?: string;
}): Promise<void>;
