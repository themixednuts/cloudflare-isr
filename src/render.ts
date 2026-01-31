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
}): RenderFunction {
  return async (request: Request) => {
    const headers = new Headers(request.headers);
    headers.set(ISR_RENDER_HEADER, "1");
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers)) {
        headers.set(key, value);
      }
    }
    return fetch(new Request(request.url, { headers }));
  };
}
