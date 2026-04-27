import { a as f, c as m, r as w } from "./isr-Dx83Ykr2.js";
let g;
function R(s, e) {
  if (!g) {
    const r = e.kvBinding ?? "ISR_CACHE", t = e.tagIndexBinding ?? "TAG_INDEX", n = s[r];
    if (!n)
      throw new Error(
        `[ISR] KV binding "${r}" not found in environment. Add [[kv_namespaces]] with binding = "${r}" to your wrangler.toml.`
      );
    const o = s[t];
    if (!o)
      throw new Error(
        `[ISR] Durable Object binding "${t}" not found in environment. Add [[durable_objects.bindings]] with name = "${t}" to your wrangler.toml, and ensure ISRTagIndexDO is exported from your worker entry point.`
      );
    g = m({
      kv: n,
      tagIndex: o,
      render: e.render ?? w(),
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
  return g;
}
function v(s = {}) {
  return {
    onRequest: async (e) => {
      const r = e.nativeEvent, t = r.context.cloudflare;
      if (!t) return;
      const { env: n, context: o } = t;
      let a;
      try {
        a = f({
          rawHost: r.headers.get("host") ?? "",
          logger: s.logger,
          protocol: s.originProtocol,
          trustedOrigin: s.trustedOrigin,
          allowedHosts: s.allowedHosts
        });
      } catch {
        return new Response("Invalid Host header", { status: 400 });
      }
      const d = new URL(r.path, a), c = new Request(d.toString(), {
        method: r.method,
        headers: Object.fromEntries(r.headers.entries())
      }), u = R(n, s).scope({ request: c }), i = e.locals;
      i.isr = u, i._isrRequest = c, i._isrCtx = o;
      const h = await u.lookup({ request: c, ctx: o });
      if (h)
        return h;
    },
    onBeforeResponse: async (e, { body: r }) => {
      const t = e.locals, n = t.isr, o = t._isrRequest, a = t._isrCtx;
      if (!n || !o || !a) return;
      const d = n.resolveConfig();
      if (!d || r == null) return;
      const c = typeof r == "string" ? r : JSON.stringify(r), l = await n.cache({
        request: o,
        body: c,
        status: e.response.status ?? 200,
        headers: e.response.headers,
        routeConfig: d,
        ctx: a
      });
      e.response.status = l.status;
      for (const [u, i] of l.headers.entries())
        e.response.headers.set(u, i);
    }
  };
}
export {
  v as handle
};
