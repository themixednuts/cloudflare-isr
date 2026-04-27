/**
 * Detects whether a request should bypass ISR caching (e.g. draft mode).
 *
 * Checks the `x-isr-bypass` header and the `__isr_bypass` cookie
 * against the configured bypass token.
 *
 * @param request  - The incoming Request object.
 * @param bypassToken - The secret token to compare against. If not provided, always returns false.
 * @returns `true` if the request carries a valid bypass token.
 */
export declare function isBypass(request: Request, bypassToken?: string): boolean;
