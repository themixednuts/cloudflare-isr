import { RequestMiddleware, ResponseMiddleware } from '@solidjs/start/middleware';
import { ISRAdapterOptions } from '../types.ts';
export type { ISRAdapterOptions } from '../types.ts';
/** Shape returned by `handle()` — compatible with `createMiddleware()`. */
export interface MiddlewareHandlers {
    onRequest: RequestMiddleware;
    onBeforeResponse: ResponseMiddleware;
}
/**
 * Create SolidStart middleware that integrates ISR.
 *
 * Returns an object with `onRequest` and `onBeforeResponse` handlers
 * compatible with `createMiddleware()`.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { handle } from "cloudflare-isr/solidstart";
 * export default createMiddleware(handle({ routes: { "/": { revalidate: 60 } } }));
 * ```
 */
export declare function handle(options?: ISRAdapterOptions): MiddlewareHandlers;
