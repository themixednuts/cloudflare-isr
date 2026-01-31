// Core API
export { createISR } from "./isr.ts";
export { renderer, ISR_RENDER_HEADER } from "./render.ts";

// Durable Object (must be re-exported for wrangler to find it)
export { ISRTagIndexDO } from "./revalidation/tag-index-do.ts";

// Storage — for advanced use cases and custom implementations
export { createWorkersStorage } from "./storage/workers.ts";
export { TagIndexDOClient } from "./revalidation/tag-index.ts";
export { createKvLock } from "./revalidation/lock.ts";

// Types
export type { WorkersStorageOptions } from "./storage/workers.ts";
export type { TagIndex } from "./revalidation/tag-index.ts";
export type {
  CacheKeyFunction,
  CacheLayer,
  CacheLayerResult,
  CacheLayerStatus,
  CacheEntry,
  CacheEntryMetadata,
  CacheStatus,
  ISRInstance,
  ISROptions,
  ISRStorage,
  Logger,
  LockProvider,
  RenderFunction,
  RenderResult,
  RevalidateValue,
  RouteConfig,
} from "./types.ts";
