import { RenderFunction } from './types.ts';
/**
 * Header that ISR adds to render requests to prevent recursion.
 *
 * When `handleRequest` sees this header, it returns `null` immediately,
 * allowing the framework to handle the request normally (producing
 * the fresh HTML that ISR will cache).
 *
 * `renderer()` adds this header automatically. If you write a custom
 * render function that self-fetches, add this header to the request:
 *
 * ```ts
 * render: async (request) => {
 *   const headers = new Headers(request.headers);
 *   headers.set(ISR_RENDER_HEADER, "1");
 *   return fetch(new Request(request.url, { headers }));
 * }
 * ```
 */
export declare const ISR_RENDER_HEADER: "X-ISR-Rendering";
/**
 * Request headers stripped before self-fetch to prevent credential leakage
 * and caching of authenticated content.
 *
 * If Cookie/Authorization are forwarded, the render produces user-specific
 * content which then gets cached and served to all visitors.
 *
 * @see CWE-212 -- Improper Removal of Sensitive Information Before Storage or Transfer
 * @see Web Cache Deception (Black Hat 2024) -- authenticated responses cached in shared cache
 */
export declare const requestHeaders: {
    SENSITIVE: readonly ["cookie", "authorization", "proxy-authorization", "x-isr-bypass"];
    strip(headers: Headers, allowlist?: readonly string[]): void;
};
/**
 * Creates a render function that self-fetches the same URL with the
 * ISR recursion guard header. This is the recommended render function
 * for middleware-based integrations (SvelteKit hooks, Nuxt plugins,
 * SolidStart middleware).
 *
 * @param init - Optional extra headers to add to the render request.
 *
 * @example
 * ```ts
 * import { createISR, renderer } from "cloudflare-isr";
 *
 * const isr = createISR({
 *   kv: env.ISR_CACHE,
 *   tagIndex: env.TAG_INDEX,
 *   render: renderer(),
 * });
 * ```
 */
export declare function renderer(init?: {
    /** Additional headers to include in the render request. */
    headers?: Record<string, string>;
    /**
     * Sensitive headers to preserve in the self-fetch request.
     * By default, Cookie, Authorization, Proxy-Authorization, and X-ISR-Bypass
     * are stripped to prevent caching authenticated content.
     *
     * @example
     * ```ts
     * // Preserve Cookie for session-aware rendering
     * renderer({ headerAllowlist: ["cookie"] })
     * ```
     */
    headerAllowlist?: string[];
}): RenderFunction;
