import { createISR, renderer, type ISRInstance } from "cloudflare-isr";

let isr: ISRInstance | undefined;

function getISR(env: { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }): ISRInstance {
  if (!isr) {
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

export default defineNitroPlugin((nitro) => {
  const originalHandler = nitro.h3App.handler;

  nitro.h3App.handler = async (event) => {
    const cf = event.context.cloudflare;
    const env = cf?.env as
      | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }
      | undefined;
    const ctx = cf?.context as ExecutionContext | undefined;

    if (!env || !ctx) {
      return originalHandler(event);
    }

    const url = getRequestURL(event);
    const request = new Request(url.toString(), {
      method: getMethod(event),
      headers: getHeaders(event) as HeadersInit,
    });

    // handleRequest returns null for non-GET/HEAD, non-matching routes,
    // and ISR render requests (recursion guard) — all fall through to Nuxt.
    const response = await getISR(env).handleRequest(request, ctx);

    if (!response) {
      return originalHandler(event);
    }

    setResponseStatus(event, response.status);
    for (const [key, value] of response.headers.entries()) {
      setResponseHeader(event, key, value);
    }
    return response.text();
  };
});
