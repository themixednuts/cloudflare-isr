import { c as l, r as g } from "./isr-Dx83Ykr2.js";
let o;
function f(a, e) {
  if (!o) {
    const r = e.kvBinding ?? "ISR_CACHE", n = e.tagIndexBinding ?? "TAG_INDEX", c = a[r];
    if (!c)
      throw new Error(
        `[ISR] KV binding "${r}" not found in environment. Add [[kv_namespaces]] with binding = "${r}" to your wrangler.toml.`
      );
    const t = a[n];
    if (!t)
      throw new Error(
        `[ISR] Durable Object binding "${n}" not found in environment. Add [[durable_objects.bindings]] with name = "${n}" to your wrangler.toml, and ensure ISRTagIndexDO is exported from your worker entry point.`
      );
    o = l({
      kv: c,
      tagIndex: t,
      render: e.render ?? g(),
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
  return o;
}
function w(a = {}) {
  return async ({ event: e, resolve: r }) => {
    const n = e.platform;
    if (!n)
      return r(e);
    const { env: c, context: t } = n, s = f(c, a).scope({ request: e.request });
    e.locals.isr = s;
    const d = await s.lookup({ request: e.request, ctx: t });
    if (d) return d;
    const u = await r(e), i = s.resolveConfig();
    return i ? s.cache({ request: e.request, response: u, routeConfig: i, ctx: t }) : u;
  };
}
export {
  w as handle
};
