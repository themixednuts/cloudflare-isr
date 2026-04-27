import { CacheKeyFunction, CacheLayer, ISRStorage, LockProvider, Logger, RevalidatePathOptions, RevalidateTagOptions, RenderFunction, RouteConfig } from '../types.ts';
import { TagIndex } from './tag-index.ts';
/**
 * Perform a background revalidation for the given cache key.
 *
 * Acquires a distributed lock so that only one worker revalidates a path at
 * a time. On success the fresh render result is written to the cache and the
 * tag-to-key index is updated. On failure the last-known-good cache entry is
 * preserved and the error is logged.
 */
export declare function revalidate(options: {
    key: string;
    request: Request;
    lock?: LockProvider;
    tagIndex: TagIndex;
    cache: CacheLayer;
    render: RenderFunction;
    defaultRevalidate?: RouteConfig["revalidate"];
    routeConfig?: RouteConfig;
    logger?: Logger;
    renderTimeout?: number;
}): Promise<void>;
interface Revalidator {
    revalidatePath(options: RevalidatePathOptions): Promise<void>;
    revalidateTag(options: RevalidateTagOptions): Promise<void>;
}
export declare function createRevalidator(options: {
    storage: ISRStorage;
    cacheKey?: CacheKeyFunction;
    logger?: Logger;
}): Revalidator;
export {};
