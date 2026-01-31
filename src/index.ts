// Core API
export { createISR } from "./isr.ts";
export { renderer, ISR_RENDER_HEADER } from "./render.ts";

// Durable Object (must be re-exported for wrangler to find it)
export { ISRTagIndexDO } from "./revalidation/tag-index-do.ts";

// Types
export type { TagIndex } from "./revalidation/tag-index.ts";
export type {
  CacheKeyFunction,
  CacheLayer,
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
