import { a as H, c as I, r as S } from "./isr-Dx83Ykr2.js";
let u;
function O(t, e) {
  if (!u) {
    const n = e.kvBinding ?? "ISR_CACHE", r = e.tagIndexBinding ?? "TAG_INDEX", s = t[n];
    if (!s)
      throw new Error(
        `[ISR] KV binding "${n}" not found in environment. Add [[kv_namespaces]] with binding = "${n}" to your wrangler.toml.`
      );
    const o = t[r];
    if (!o)
      throw new Error(
        `[ISR] Durable Object binding "${r}" not found in environment. Add [[durable_objects.bindings]] with name = "${r}" to your wrangler.toml, and ensure ISRTagIndexDO is exported from your worker entry point.`
      );
    u = I({
      kv: s,
      tagIndex: o,
      render: e.render ?? S(),
      routes: e.routes,
      logger: e.logger,
      bypassToken: e.bypassToken,
      defaultRevalidate: e.defaultRevalidate,
      renderTimeout: e.renderTimeout,
      lockOnMiss: e.lockOnMiss,
      exposeHeaders: e.exposeHeaders,
      shouldCacheStatus: e.shouldCacheStatus,
      cacheKey: e.cacheKey,
      cacheName: e.cacheName
    });
  }
  return u;
}
function C(t = {}) {
  return (e) => {
    const n = e.h3App.handler;
    e.h3App.handler = async (r) => {
      const s = r.context.cloudflare;
      if (!s)
        return n(r);
      const { env: o, context: l } = s;
      let g;
      try {
        g = H({
          rawHost: r.headers.get("host") ?? "",
          logger: t.logger,
          protocol: t.originProtocol,
          trustedOrigin: t.trustedOrigin,
          allowedHosts: t.allowedHosts
        });
      } catch {
        return new Response("Invalid Host header", { status: 400 });
      }
      const m = new URL(r.path, g), i = new Request(m.toString(), {
        method: r.method,
        headers: r.headers
      }), a = O(o, t).scope({ request: i });
      r.context.isr = a;
      const h = await a.lookup({ request: i, ctx: l });
      if (h) {
        r.respondWith(h);
        return;
      }
      const d = await n(r), f = a.resolveConfig();
      if (f) {
        const y = typeof d == "string" ? d : JSON.stringify(d), R = r.node.res.statusCode, b = r.node.res.getHeaders(), w = {};
        for (const [x, c] of Object.entries(b))
          c !== void 0 && (w[x] = Array.isArray(c) ? c.join(", ") : String(c));
        const k = await a.cache({
          request: i,
          body: y,
          status: R,
          headers: w,
          routeConfig: f,
          ctx: l
        });
        r.respondWith(k);
        return;
      }
      return d;
    };
  };
}
export {
  C as handle
};
