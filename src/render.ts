import type { RenderFunction } from "./types.ts";

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
export const ISR_RENDER_HEADER = "X-ISR-Rendering" as const;

/**
 * Request headers stripped before self-fetch to prevent credential leakage
 * and caching of authenticated content.
 *
 * If Cookie/Authorization are forwarded, the render produces user-specific
 * content which then gets cached and served to all visitors.
 *
 * @see CWE-598 -- Use of GET Request Method With Sensitive Query Strings (credentials in self-fetch)
 * @see Web Cache Deception (Black Hat 2024) -- authenticated responses cached in shared cache
 */
export const requestHeaders = {
  SENSITIVE: ["cookie", "authorization", "proxy-authorization", "x-isr-bypass"] as const,
  strip(headers: Headers, allowlist?: readonly string[]): void {
    const allowed = allowlist
      ? new Set(allowlist.map((h) => h.toLowerCase()))
      : undefined;
    for (const name of requestHeaders.SENSITIVE) {
      if (!allowed?.has(name)) {
        headers.delete(name);
      }
    }
  },
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
export function renderer(init?: {
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
}): RenderFunction {
  return async (request: Request) => {
    const headers = new Headers(request.headers);
    requestHeaders.strip(headers, init?.headerAllowlist);
    headers.set(ISR_RENDER_HEADER, "1");
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers)) {
        headers.set(key, value);
      }
    }
    return fetch(new Request(request.url, { headers }));
  };
}
