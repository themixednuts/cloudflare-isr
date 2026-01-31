import { createMiddleware } from "@solidjs/start/middleware";
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

export default createMiddleware({
  onRequest: [
    async (event) => {
      const nativeEvent = event.nativeEvent;

      const cf = (nativeEvent as any).context?.cloudflare;
      const env = cf?.env as
        | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }
        | undefined;
      const ctx = cf?.context as ExecutionContext | undefined;

      if (!env || !ctx) return;

      const url = new URL(nativeEvent.url);
      const request = new Request(url.toString(), {
        method: nativeEvent.method,
        headers: Object.fromEntries(nativeEvent.headers.entries()),
      });

      // handleRequest returns null for non-GET/HEAD, non-matching routes,
      // and ISR render requests (recursion guard) — all fall through to SolidStart.
      const response = await getISR(env).handleRequest(request, ctx);

      if (!response) return;

      event.response.status = response.status;
      for (const [key, value] of response.headers.entries()) {
        event.response.headers.set(key, value);
      }
      return await response.text();
    },
  ],
});
