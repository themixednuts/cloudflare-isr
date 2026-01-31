import type { Handle } from "@sveltejs/kit";
import type { ISRInstance } from "cloudflare-isr";

let isr: ISRInstance | undefined;

async function getISR(env: App.Platform["env"]): Promise<ISRInstance> {
  if (!isr) {
    // Dynamic import is required here. A static `import` would cause Vite's SSR
    // build to pull in cloudflare-isr (which imports `cloudflare:workers`), and
    // Node.js crashes because it doesn't understand the `cloudflare:` scheme.
    // See: https://github.com/cloudflare/workers-sdk/issues/10254
    const { createISR, renderer } = await import("cloudflare-isr");

    isr = createISR({
      kv: env.ISR_CACHE,
      tagIndex: env.TAG_INDEX,
      routes: {
        "/": { revalidate: 60, tags: ["home"] },
        "/blog/[slug]": { revalidate: 120, tags: ["blog"] },
      },
      render: renderer(),
    });
  }
  return isr;
}

export const handle: Handle = async ({ event, resolve }) => {
  const env = event.platform?.env;
  const ctx = event.platform?.context;

  // During dev without platform bindings, fall through to SvelteKit
  if (!env || !ctx) {
    return resolve(event);
  }

  // handleRequest returns null for non-GET/HEAD, non-matching routes,
  // and ISR render requests (recursion guard) — all fall through to SvelteKit.
  const response = await (await getISR(env)).handleRequest(event.request, ctx);
  return response ?? resolve(event);
};
