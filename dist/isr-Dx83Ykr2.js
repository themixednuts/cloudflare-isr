var Se = Object.defineProperty;
var Q = (e, t) => (t = Symbol[e]) ? t : Symbol.for("Symbol." + e), ee = (e) => {
  throw TypeError(e);
};
var Te = (e, t, r) => t in e ? Se(e, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : e[t] = r;
var F = (e, t, r) => Te(e, typeof t != "symbol" ? t + "" : t, r);
var te = (e, t, r) => {
  if (t != null) {
    typeof t != "object" && typeof t != "function" && ee("Object expected");
    var a, n;
    r && (a = t[Q("asyncDispose")]), a === void 0 && (a = t[Q("dispose")], r && (n = a)), typeof a != "function" && ee("Object not disposable"), n && (a = function() {
      try {
        n.call(this);
      } catch (o) {
        return Promise.reject(o);
      }
    }), e.push([r, a, t]);
  } else r && e.push([r]);
  return t;
}, re = (e, t, r) => {
  var a = typeof SuppressedError == "function" ? SuppressedError : function(s, c, i, d) {
    return d = Error(i), d.name = "SuppressedError", d.error = s, d.suppressed = c, d;
  }, n = (s) => t = r ? new a(s, t, "An error was suppressed during disposal") : (r = !0, s), o = (s) => {
    for (; s = e.pop(); )
      try {
        var c = s[1] && s[1].call(s[2]);
        if (s[0]) return Promise.resolve(c).then(o, (i) => (n(i), o()));
      } catch (i) {
        n(i);
      }
    if (r) throw t;
  };
  return o();
};
function ae(e, t) {
  if (!t)
    return !1;
  const r = e.headers.get("x-isr-bypass");
  if (r && ne(r.trim(), t))
    return !0;
  const a = e.headers.get("cookie");
  if (a) {
    const n = be(a, "__isr_bypass");
    if (n && ne(n, t))
      return !0;
  }
  return !1;
}
function ne(e, t) {
  const r = Math.max(e.length, t.length);
  let a = e.length ^ t.length;
  for (let n = 0; n < r; n += 1)
    a |= (e.charCodeAt(n) || 0) ^ (t.charCodeAt(n) || 0);
  return a === 0;
}
function be(e, t) {
  const r = e.split(";");
  for (const a of r) {
    const n = a.trim();
    if (!n.startsWith(t + "=")) continue;
    const o = n.slice(t.length + 1);
    if (!o) return null;
    try {
      return decodeURIComponent(o);
    } catch {
      return null;
    }
  }
  return null;
}
const X = "X-ISR-Rendering", de = {
  SENSITIVE: ["cookie", "authorization", "proxy-authorization", "x-isr-bypass"],
  strip(e, t) {
    const r = t ? new Set(t.map((a) => a.toLowerCase())) : void 0;
    for (const a of de.SENSITIVE)
      r != null && r.has(a) || e.delete(a);
  }
};
function Ze(e) {
  return async (t) => {
    const r = new Headers(t.headers);
    if (de.strip(r, e == null ? void 0 : e.headerAllowlist), r.set(X, "1"), e != null && e.headers)
      for (const [a, n] of Object.entries(e.headers))
        r.set(a, n);
    return fetch(new Request(t.url, { headers: r }));
  };
}
const se = 512, oe = /* @__PURE__ */ new WeakMap();
function ve(e) {
  const t = oe.get(e);
  if (t) return t;
  const r = Object.entries(e).map(([a, n]) => ({
    pattern: a,
    config: n,
    regex: Ie(a)
  }));
  return oe.set(e, r), r;
}
function pe(e) {
  if (e.length > se)
    throw new Error(
      `Route pattern exceeds maximum length of ${se}: ${e.slice(0, 60)}...`
    );
  const t = e.match(/\[\.\.\./g);
  if (t && t.length > 1)
    throw new Error(
      `Route pattern must not contain multiple catch-all segments: ${e}`
    );
}
function ce(e, t) {
  for (const { pattern: r, config: a, regex: n } of ve(t)) {
    if (r === e)
      return { pattern: r, config: a };
    if (n.test(e))
      return { pattern: r, config: a };
  }
  return null;
}
function Ie(e) {
  pe(e);
  let t = "", r = 0;
  for (; r < e.length; ) {
    if (e[r] === "[" && e.substring(r).startsWith("[...")) {
      const n = e.indexOf("]", r);
      if (n !== -1) {
        t += "(.+)", r = n + 1;
        continue;
      }
    }
    if (e[r] === "[") {
      const n = e.indexOf("]", r);
      if (n !== -1) {
        t += "([^/]+)", r = n + 1;
        continue;
      }
    }
    if (e[r] === ":") {
      let n = r + 1;
      for (; n < e.length && e[n] !== "/"; )
        n++;
      if (n > r + 1) {
        t += "([^/]+)", r = n;
        continue;
      }
    }
    if (e[r] === "*" && r === e.length - 1) {
      t += "(.*)", r++;
      continue;
    }
    const a = e[r];
    "\\^$.|?+(){}".includes(a) ? t += "\\" + a : t += a, r++;
  }
  return new RegExp("^" + t + "$");
}
function Y(e, t) {
  const r = (e == null ? void 0 : e.prefix) ?? "[ISR]";
  if (t.length === 0) return [r];
  const [a, ...n] = t;
  return typeof a == "string" ? [`${r} ${a}`, ...n] : [r, a, ...n];
}
function A(e, ...t) {
  e != null && e.debug && e.debug(...Y(e, t));
}
function T(e, ...t) {
  const r = Y(e, t);
  if (e != null && e.warn) {
    e.warn(...r);
    return;
  }
  console.warn(...r);
}
function G(e, ...t) {
  const r = Y(e, t);
  if (e != null && e.error) {
    e.error(...r);
    return;
  }
  console.error(...r);
}
const Re = 480;
function ke(e) {
  let t = 5381, r = 2166136261;
  for (let a = 0; a < e.length; a++) {
    const n = e.charCodeAt(a);
    t = (t << 5) + t + n >>> 0, r = (r ^ n) * 16777619 >>> 0;
  }
  return t.toString(16).padStart(8, "0") + r.toString(16).padStart(8, "0");
}
function fe(e, t) {
  const r = `${e}${t}`;
  return new TextEncoder().encode(r).byteLength <= Re ? r : `${e}hash:${ke(t)}`;
}
function V(e) {
  return fe("page:", e);
}
function Ee(e) {
  return fe("lock:", e);
}
function q(e) {
  return `https://isr.internal/__isr/${encodeURIComponent(e)}`;
}
function xe(e) {
  let t = e.pathname;
  return t = t.replace(/\/{2,}/g, "/"), t.length > 1 && t.endsWith("/") && (t = t.slice(0, -1)), t;
}
function he(e) {
  const t = xe(e);
  if (!e.searchParams || [...e.searchParams].length === 0)
    return t;
  const r = [...e.searchParams.entries()].sort(([a, n], [o, s]) => a === o ? n.localeCompare(s) : a.localeCompare(o)).map(([a, n]) => `${encodeURIComponent(a)}=${encodeURIComponent(n)}`).join("&");
  return `${t}?${r}`;
}
const Ae = 60, B = new TextEncoder();
async function O(e) {
  if (!(e instanceof Response))
    return e;
  const t = await e.text(), r = {};
  for (const [a, n] of e.headers.entries())
    r[a] = n;
  return { body: t, status: e.status, headers: r };
}
function Ce(e, t) {
  const r = new Headers();
  for (const [a, n] of Object.entries(e))
    if (n !== void 0)
      try {
        r.set(a, n);
      } catch (o) {
        T(t, `Dropping invalid header "${a}":`, o);
      }
  return Object.fromEntries(r.entries());
}
const ye = {
  UNCACHEABLE: ["set-cookie", "www-authenticate", "proxy-authenticate"],
  strip(e) {
    const t = {};
    for (const [r, a] of Object.entries(e))
      ye.UNCACHEABLE.includes(r.toLowerCase()) || (t[r] = a);
    return t;
  }
}, N = {
  PATTERN: /^[a-zA-Z0-9._\-]+(:\d{1,5})?$/,
  sanitizeOrNull(e, t) {
    const r = e.trim();
    if (!N.PATTERN.test(r))
      return T(t, `Invalid Host header rejected: "${r.slice(0, 64)}"`), null;
    const { port: a } = N.split(r);
    if (a) {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 1 || n > 65535)
        return T(t, `Invalid Host port rejected: "${r.slice(0, 64)}"`), null;
    }
    return r;
  },
  sanitize(e, t) {
    return N.sanitizeOrNull(e, t) ?? "localhost";
  },
  split(e) {
    const t = e.lastIndexOf(":");
    if (t === -1)
      return { hostname: e.toLowerCase() };
    const r = e.slice(0, t).toLowerCase(), a = e.slice(t + 1);
    return a ? { hostname: r, port: a } : { hostname: r };
  }
};
function Qe(e) {
  const t = e.protocol ?? "https";
  if (e.trustedOrigin) {
    let a;
    try {
      a = new URL(e.trustedOrigin);
    } catch {
      throw new Error("[ISR] Invalid trustedOrigin; expected absolute URL.");
    }
    if (a.protocol !== "https:" && a.protocol !== "http:")
      throw new Error("[ISR] trustedOrigin must use http or https protocol.");
    return a.origin;
  }
  const r = N.sanitizeOrNull(e.rawHost, e.logger);
  if (!r)
    throw new Error("[ISR] Invalid Host header.");
  if (e.allowedHosts && e.allowedHosts.length > 0) {
    const a = N.split(r);
    if (!e.allowedHosts.some((o) => {
      const s = N.sanitizeOrNull(o);
      if (!s) return !1;
      const c = N.split(s);
      return c.port ? a.hostname === c.hostname && a.port === c.port : a.hostname === c.hostname;
    }))
      throw new Error("[ISR] Host header is not in allowedHosts.");
  }
  return `${t}://${r}`;
}
const ie = 64, le = 128, Le = /^[a-zA-Z0-9_\-.:\/]+$/;
function $e(e) {
  if (e.length === 0)
    throw new Error("[ISR] Tag must not be empty.");
  if (e.length > le)
    throw new Error(
      `[ISR] Tag exceeds maximum length of ${le} characters: "${e.slice(0, 32)}..."`
    );
  if (!Le.test(e))
    throw new Error(
      `[ISR] Tag contains invalid characters (allowed: a-z, A-Z, 0-9, _ - . : /): "${e}"`
    );
}
function Ne(e) {
  if (!e || e.length === 0) return [];
  const t = [], r = /* @__PURE__ */ new Set();
  for (const a of e) {
    const n = a.trim();
    !n || r.has(n) || ($e(n), r.add(n), t.push(n));
  }
  if (t.length > ie)
    throw new Error(
      `[ISR] Too many tags: ${t.length} exceeds maximum of ${ie}.`
    );
  return t;
}
function P(e) {
  return e.render !== void 0 ? e.render : e.route !== void 0 ? e.route : e.defaultValue ?? Ae;
}
function U(e) {
  return typeof e == "number" && e <= 0;
}
function ge(e) {
  return e === !1;
}
function He(e, t) {
  return ge(e) ? null : t + e * 1e3;
}
function we(e, t) {
  return e === null || t < e ? "HIT" : "STALE";
}
async function j(e) {
  try {
    return await e.get();
  } catch (t) {
    const r = e.label ? `Failed to read ${e.label} cache:` : "Cache read failed:";
    return T(e.logger, r, t), { entry: null, status: "MISS" };
  }
}
function Me(e, t) {
  const r = t.toLowerCase();
  return Object.keys(e).some((a) => a.toLowerCase() === r);
}
function Oe(e, t, r) {
  const a = ye.strip(Ce(e, r));
  if (Me(a, "cache-control")) {
    T(
      r,
      "Render response contained a Cache-Control header which was overridden by ISR."
    );
    for (const o of Object.keys(a))
      o.toLowerCase() === "cache-control" && delete a[o];
  }
  if (t === !1)
    return {
      ...a,
      "Cache-Control": "public, max-age=0, s-maxage=31536000, immutable"
    };
  const n = Math.max(0, Math.floor(t));
  return {
    ...a,
    "Cache-Control": `public, max-age=0, s-maxage=${n}, stale-while-revalidate=${n}`
  };
}
const M = 1024;
function me(e, t) {
  const r = JSON.stringify(e), a = B.encode(r).byteLength;
  if (a <= M)
    return e.tags;
  const n = { ...e, tags: [] }, o = B.encode(JSON.stringify(n)).byteLength;
  if (o > M)
    return T(
      t,
      `KV metadata base exceeds ${M} bytes (${o}B), dropping all tags`
    ), [];
  const s = [];
  let c = o;
  for (const i of e.tags) {
    const d = { ...e, tags: [...s, i] }, w = B.encode(JSON.stringify(d)).byteLength;
    if (w > M)
      break;
    s.push(i), c = w;
  }
  return T(
    t,
    `KV metadata exceeds ${M} bytes (${a}B), truncated tags from ${e.tags.length} to ${s.length} (${c}B)`
  ), s;
}
const Pe = {
  validate(e) {
    if (typeof e != "object" || e === null) return null;
    const t = e;
    return typeof t.body != "string" || typeof t.metadata != "object" || t.metadata === null || typeof t.metadata.createdAt != "number" || t.headers !== void 0 && (typeof t.headers != "object" || Array.isArray(t.headers)) ? null : e;
  }
};
function _e(e) {
  const { result: t, routeConfig: r, revalidateSeconds: a, now: n, logger: o } = e, s = Ne(t.tags ?? (r == null ? void 0 : r.tags)), c = {
    createdAt: n,
    revalidateAfter: He(a, n),
    status: t.status,
    tags: s
  }, i = me(c, o);
  return i !== s ? { ...c, tags: i } : c;
}
function J(e) {
  const t = _e(e), r = Oe(
    e.result.headers ?? {},
    e.revalidateSeconds,
    e.logger
  );
  return { body: e.result.body, headers: r, metadata: t };
}
async function W(e) {
  const { tagIndex: t, tags: r, key: a, logger: n, context: o } = e;
  if (r.length !== 0)
    try {
      await t.addKeyToTags(r, a);
    } catch (s) {
      T(n, o ?? "Failed to update tag index:", s);
    }
}
async function ue(e) {
  var R = [];
  try {
    const {
      key: t,
      request: r,
      lock: a,
      tagIndex: n,
      cache: o,
      render: s,
      defaultRevalidate: c,
      routeConfig: i,
      logger: d,
      renderTimeout: w
    } = e;
    const m = te(R, a ? await a.acquire(t) : null, !0);
    if (a && !m)
      return;
    try {
      const f = s(r), b = await O(
        w && w > 0 && Number.isFinite(w) ? await new Promise((y, h) => {
          const I = setTimeout(
            () => h(new Error(`[ISR] Background render timeout (${w}ms)`)),
            w
          );
          f.then(
            (S) => {
              clearTimeout(I), y(S);
            },
            (S) => {
              clearTimeout(I), h(S);
            }
          );
        }) : await f
      ), k = P({
        render: b.revalidate,
        route: i == null ? void 0 : i.revalidate,
        defaultValue: c
      });
      if (U(k)) {
        await o.delete(t);
        return;
      }
      const p = Date.now(), l = J({
        result: b,
        routeConfig: i,
        revalidateSeconds: k,
        now: p,
        logger: d
      });
      await Promise.all([
        o.put(t, l),
        W({
          tagIndex: n,
          tags: l.metadata.tags,
          key: t,
          logger: d,
          context: "Failed to update tag index during revalidation:"
        })
      ]);
    } catch (f) {
      G(d, `Background revalidation failed for "${t}":`, f);
    }
  } catch (_) {
    var K = _, C = !0;
  } finally {
    var u = re(R, K, C);
    u && await u;
  }
}
const De = 25;
async function Ue(e, t, r, a) {
  if (e.length === 0) return;
  let n = 0;
  const o = [], s = Array.from(
    { length: Math.min(t, e.length) },
    async () => {
      for (; n < e.length; ) {
        const c = e[n++];
        try {
          await r(c);
        } catch (i) {
          o.push(i);
        }
      }
    }
  );
  await Promise.all(s), o.length > 0 && T(a, `${o.length} invalidation errors occurred.`);
}
function je(e) {
  const t = e.cacheKey ?? he, r = e.logger;
  function a(n) {
    return t(typeof n == "string" ? new URL(n, "https://isr.internal") : n);
  }
  return {
    async revalidatePath(n) {
      await e.storage.cache.delete(a(n.path));
    },
    async revalidateTag(n) {
      const { tag: o } = n, s = await e.storage.tagIndex.getKeysByTag(o);
      await Promise.all([
        Ue(
          s,
          De,
          (c) => e.storage.cache.delete(c),
          r
        ),
        e.storage.tagIndex.removeAllKeysForTag(o)
      ]);
    }
  };
}
async function Ke(e, t, r) {
  const a = Ee(t);
  return await e.get(a) !== null ? null : (await e.put(a, Date.now().toString(), { expirationTtl: 60 }), {
    async [Symbol.asyncDispose]() {
      try {
        await e.delete(a);
      } catch (o) {
        T(r, `Failed to release lock "${a}":`, o);
      }
    }
  });
}
function Fe(e, t) {
  return {
    acquire: (r) => Ke(e, r, t)
  };
}
function Ve(e) {
  const r = caches.open(e);
  return {
    async get(a) {
      const n = await r, o = q(a), s = await n.match(o);
      if (!s)
        return { entry: null, status: "MISS" };
      let c;
      try {
        c = await s.json();
      } catch {
        return { entry: null, status: "MISS" };
      }
      const i = Pe.validate(c);
      if (!i)
        return { entry: null, status: "MISS" };
      const d = Date.now(), w = we(i.metadata.revalidateAfter, d);
      return { entry: i, status: w };
    },
    async put(a, n) {
      const o = await r, s = q(a), c = n.metadata.revalidateAfter === null ? 31536e3 : Math.max(
        1,
        Math.ceil((n.metadata.revalidateAfter - Date.now()) / 1e3)
      ), i = new Response(JSON.stringify(n), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `s-maxage=${c}`
        }
      });
      await o.put(s, i);
    },
    async delete(a) {
      const n = await r, o = q(a);
      await n.delete(o);
    }
  };
}
function qe(e, t) {
  return {
    async get(r) {
      const a = V(r), { value: n, metadata: o } = await e.getWithMetadata(a, "text");
      if (n === null || o === null)
        return { entry: null, status: "MISS" };
      let s, c;
      try {
        const m = JSON.parse(n);
        if (typeof m == "object" && m !== null && "body" in m) {
          if (typeof m.body != "string")
            return T(t, "KV entry has non-string body, treating as cache miss"), { entry: null, status: "MISS" };
          if (m.headers !== void 0 && m.headers !== null && (typeof m.headers != "object" || Array.isArray(m.headers)))
            return T(t, "KV entry has invalid headers, treating as cache miss"), { entry: null, status: "MISS" };
          s = m.body, c = m.headers ?? {};
        } else
          s = n, c = {};
      } catch {
        s = n, c = {};
      }
      const i = { body: s, headers: c, metadata: o }, d = Date.now(), w = we(o.revalidateAfter, d);
      return { entry: i, status: w };
    },
    async put(r, a) {
      const n = V(r), o = { body: a.body, headers: a.headers }, s = me(a.metadata, t), c = s !== a.metadata.tags ? { ...a.metadata, tags: s } : a.metadata;
      await e.put(n, JSON.stringify(o), { metadata: c });
    },
    async delete(r) {
      const a = V(r);
      await e.delete(a);
    }
  };
}
function Be(e, t, r) {
  async function a(s, c) {
    const i = await Promise.allSettled(c.map((d) => d.promise));
    for (const [d, w] of i.entries()) {
      const m = c[d];
      m && w.status === "rejected" && T(
        r,
        `Failed to ${s} ${m.layer} cache:`,
        w.reason
      );
    }
  }
  function n(s, c) {
    return s ? c ? s.metadata.createdAt >= c.metadata.createdAt ? s : c : s : c;
  }
  function o(s, c) {
    e.put(s, c).catch((i) => {
      T(r, "Failed to backfill L1 cache:", i);
    });
  }
  return {
    async get(s) {
      const c = await j({
        get: () => e.get(s),
        logger: r,
        label: "L1"
      });
      if (c.status === "HIT")
        return c;
      const i = await j({
        get: () => t.get(s),
        logger: r,
        label: "L2"
      });
      if (c.status === "STALE") {
        if (i.status === "HIT" && i.entry)
          return o(s, i.entry), i;
        if (i.status === "STALE") {
          const d = n(c.entry, i.entry);
          return d ? { entry: d, status: "STALE" } : { entry: null, status: "MISS" };
        }
        return c;
      }
      return i.status === "HIT" && i.entry ? (o(s, i.entry), i) : i.status === "STALE" ? i : { entry: null, status: "MISS" };
    },
    async put(s, c) {
      await a("write", [
        { layer: "L1", promise: e.put(s, c) },
        { layer: "L2", promise: t.put(s, c) }
      ]);
    },
    async delete(s) {
      await a("delete", [
        { layer: "L1", promise: e.delete(s) },
        { layer: "L2", promise: t.delete(s) }
      ]);
    }
  };
}
function ze(e) {
  const t = e.cacheName ?? "isr", r = Ve(t), a = qe(e.kv, e.logger), n = Be(r, a, e.logger), o = e.tagIndex, s = Fe(e.kv, e.logger);
  return { cache: n, tagIndex: o, lock: s };
}
class Xe {
  constructor(t, r) {
    F(this, "ns");
    F(this, "doName");
    this.ns = t, this.doName = (r == null ? void 0 : r.name) ?? "global";
  }
  /** Get a fresh stub for the current request context. */
  stub() {
    return this.ns.get(this.ns.idFromName(this.doName));
  }
  /** Assert the DO response is OK, throwing a helpful error if not. */
  async assertOk(t, r) {
    var n;
    if (t.ok) return;
    if (t.status === 404)
      throw await ((n = t.body) == null ? void 0 : n.cancel()), new Error(
        `TagIndexDO ${r} failed: 404 — Durable Object not found. Ensure ISRTagIndexDO is exported from your worker entry point and configured in wrangler.toml/wrangler.jsonc.`
      );
    const a = await t.text().catch(() => "");
    throw t.status === 500 ? new Error(
      `TagIndexDO ${r} failed: 500 — ${a || "Internal error"}`
    ) : new Error(
      `TagIndexDO ${r} failed: ${t.status}${a ? ` — ${a}` : ""}`
    );
  }
  async addKeyToTag(t, r) {
    var n;
    const a = await this.stub().fetch("http://do/add", {
      method: "POST",
      body: JSON.stringify({ tag: t, key: r }),
      headers: { "Content-Type": "application/json" }
    });
    await this.assertOk(a, "add"), await ((n = a.body) == null ? void 0 : n.cancel());
  }
  async addKeyToTags(t, r) {
    var n;
    if (t.length === 0) return;
    if (t.length === 1) return this.addKeyToTag(t[0], r);
    const a = await this.stub().fetch("http://do/add-bulk", {
      method: "POST",
      body: JSON.stringify({ tags: t, key: r }),
      headers: { "Content-Type": "application/json" }
    });
    await this.assertOk(a, "add-bulk"), await ((n = a.body) == null ? void 0 : n.cancel());
  }
  async getKeysByTag(t) {
    const r = await this.stub().fetch(
      `http://do/get?tag=${encodeURIComponent(t)}`
    );
    return await this.assertOk(r, "get"), r.json();
  }
  async removeKeyFromTag(t, r) {
    var n;
    const a = await this.stub().fetch("http://do/remove", {
      method: "POST",
      body: JSON.stringify({ tag: t, key: r }),
      headers: { "Content-Type": "application/json" }
    });
    await this.assertOk(a, "remove"), await ((n = a.body) == null ? void 0 : n.cancel());
  }
  async removeAllKeysForTag(t) {
    var a;
    const r = await this.stub().fetch("http://do/remove-tag", {
      method: "POST",
      body: JSON.stringify({ tag: t }),
      headers: { "Content-Type": "application/json" }
    });
    await this.assertOk(r, "remove-tag"), await ((a = r.body) == null ? void 0 : a.cancel());
  }
}
const Ge = 25e3;
function D(e, t, r) {
  return t <= 0 || !Number.isFinite(t) ? e : new Promise((a, n) => {
    const o = setTimeout(() => n(new Error(`[ISR] ${r} (${t}ms)`)), t);
    e.then(
      (s) => {
        clearTimeout(o), a(s);
      },
      (s) => {
        clearTimeout(o), n(s);
      }
    );
  });
}
function Je(e) {
  if ("kv" in e && e.kv) {
    const t = new Xe(e.tagIndex);
    return ze({
      kv: e.kv,
      tagIndex: t,
      cacheName: e.cacheName,
      logger: e.logger
    });
  }
  return e.storage;
}
function We(e) {
  return "metadata" in e && typeof e.metadata == "object" && e.metadata !== null && "createdAt" in e.metadata;
}
function E(e, t, r, a) {
  const n = We(e), o = e.body, s = n ? e.metadata.status : e.status, c = n ? e.headers : e.headers ?? {}, i = new Headers();
  for (const [w, m] of Object.entries(c))
    if (m !== void 0)
      try {
        i.set(w, m);
      } catch (R) {
        T(r, `Dropping invalid header "${w}":`, R);
      }
  return (a == null ? void 0 : a.exposeHeaders) !== !1 && (i.set("X-ISR-Status", t), n && i.set("X-ISR-Cache-Date", new Date(e.metadata.createdAt).toUTCString())), a != null && a.noStore && i.set("Cache-Control", "no-store"), new Response(o, { status: s, headers: i });
}
function z(e) {
  return e.headers.set("Cache-Control", "private, no-cache"), e;
}
function et(e) {
  if ("kv" in e && e.kv && "storage" in e && e.storage)
    throw new Error(
      "[ISR] Cannot mix shorthand (kv, tagIndex) and advanced (storage) config. Choose one."
    );
  const t = e.logger, r = Je(e), a = r.cache, n = r.tagIndex, o = e.cacheKey ?? he, s = P({
    defaultValue: e.defaultRevalidate
  }), c = e.renderTimeout ?? Ge, i = e.lockOnMiss !== !1, d = e.exposeHeaders !== !1, w = e.shouldCacheStatus ?? ((u) => u < 500 && u !== 204), m = crypto.randomUUID(), R = {
    wrap(u) {
      const f = new Headers(u.headers);
      return f.set(X, m), new Request(u.url, { headers: f });
    },
    isRender(u) {
      return u.headers.get(X) === m;
    }
  }, _ = je({
    storage: r,
    cacheKey: o,
    logger: t
  });
  function K() {
    if (!e.render)
      throw new Error(
        "[ISR] No render function provided. Pass `render` to createISR() when using handleRequest."
      );
    return e.render;
  }
  const C = {
    async handleRequest(u) {
      const { request: f, ctx: b, routeConfig: k } = u;
      if (f.method !== "GET" && f.method !== "HEAD" || R.isRender(f))
        return null;
      const p = new URL(f.url), l = p.pathname, y = o(p);
      let h;
      if (k)
        h = k;
      else {
        const g = e.routes ? ce(l, e.routes) : null;
        if (h = g == null ? void 0 : g.config, !(e.routes ? g !== null : !0))
          return null;
      }
      const I = K();
      if (ae(f, e.bypassToken)) {
        const g = await O(
          await D(I(R.wrap(f)), c, "Render timeout")
        );
        return E(g, "BYPASS", t, { noStore: !0, exposeHeaders: d });
      }
      const S = P({
        route: h == null ? void 0 : h.revalidate,
        defaultValue: s
      });
      if (U(S)) {
        const g = await O(
          await D(I(R.wrap(f)), c, "Render timeout")
        );
        return b.waitUntil(
          a.delete(y).catch((Z) => {
            T(t, "Failed to delete cache entry:", Z);
          })
        ), E(g, "SKIP", t, { noStore: !0, exposeHeaders: d });
      }
      const L = await j({ get: () => a.get(y), logger: t });
      if (L.status === "HIT" && L.entry)
        return E(L.entry, "HIT", t, { exposeHeaders: d });
      if (L.status === "STALE" && L.entry)
        return ge(S) ? E(L.entry, "HIT", t, { exposeHeaders: d }) : (b.waitUntil(
          ue({
            key: y,
            request: f,
            lock: r.lock,
            tagIndex: n,
            cache: a,
            render: (g) => I(R.wrap(g)),
            defaultRevalidate: s,
            routeConfig: h,
            logger: t,
            renderTimeout: 2 * c
          }).catch((g) => {
            T(t, "Background revalidation failed:", g);
          })
        ), E(L.entry, "STALE", t, { exposeHeaders: d }));
      if (i && r.lock) {
        const g = await r.lock.acquire(y);
        if (!g)
          return null;
        b.waitUntil(
          (async () => {
            await g[Symbol.asyncDispose]();
          })().catch(() => {
          })
        );
      }
      const $ = await O(
        await D(I(R.wrap(f)), c, "Render timeout")
      ), H = P({
        render: $.revalidate,
        route: h == null ? void 0 : h.revalidate,
        defaultValue: s
      });
      if (U(H))
        return b.waitUntil(
          a.delete(y).catch((g) => {
            T(t, "Failed to delete cache entry:", g);
          })
        ), E($, "SKIP", t, { noStore: !0, exposeHeaders: d });
      if (!w($.status))
        return A(t, "Skipping cache for status", $.status, "on", y), E($, "MISS", t, { exposeHeaders: d });
      const v = Date.now(), x = J({
        result: $,
        routeConfig: h,
        revalidateSeconds: H,
        now: v,
        logger: t
      });
      return b.waitUntil(
        (async () => {
          await Promise.all([
            a.put(y, x),
            W({
              tagIndex: n,
              tags: x.metadata.tags,
              key: y,
              logger: t
            })
          ]);
        })().catch((g) => {
          G(t, "Failed to persist cache entry:", g);
        })
      ), E(x, "MISS", t, { exposeHeaders: d });
    },
    async lookup(u) {
      const { request: f, ctx: b } = u;
      if (f.method !== "GET" && f.method !== "HEAD")
        return A(t, "lookup: skipping non-GET/HEAD method", f.method), null;
      if (R.isRender(f))
        return A(t, "lookup: skipping render request (recursion guard)"), null;
      const k = new URL(f.url), p = o(k);
      if (ae(f, e.bypassToken)) {
        if (A(t, "lookup: bypass token detected for", p), e.render) {
          const y = await O(
            await D(e.render(R.wrap(f)), c, "Render timeout")
          );
          return E(y, "BYPASS", t, { noStore: !0, exposeHeaders: d });
        }
        return null;
      }
      const l = await j({ get: () => a.get(p), logger: t });
      if (l.status === "HIT" && l.entry)
        return A(t, "lookup: HIT for", p), z(E(l.entry, "HIT", t, { exposeHeaders: d }));
      if (l.status === "STALE" && l.entry) {
        if (A(t, "lookup: STALE for", p), b && e.render) {
          const y = {
            revalidate: l.entry.metadata.revalidateAfter !== null ? Math.max(0, Math.round((l.entry.metadata.revalidateAfter - l.entry.metadata.createdAt) / 1e3)) : !1,
            tags: l.entry.metadata.tags.length > 0 ? l.entry.metadata.tags : void 0
          };
          b.waitUntil(
            ue({
              key: p,
              request: f,
              lock: r.lock,
              tagIndex: n,
              cache: a,
              render: (h) => e.render(R.wrap(h)),
              defaultRevalidate: s,
              routeConfig: y,
              logger: t,
              renderTimeout: 2 * c
            }).catch((h) => {
              T(t, "lookup: background revalidation failed:", h);
            })
          );
        }
        return z(E(l.entry, "STALE", t, { exposeHeaders: d }));
      }
      return A(t, "lookup: MISS for", p), null;
    },
    async cache(u) {
      const { request: f, routeConfig: b, ctx: k } = u, p = new URL(f.url), l = o(p), y = P({
        route: b.revalidate,
        defaultValue: s
      });
      if (U(y)) {
        A(t, "cache: SKIP (revalidate ≤ 0) for", l), k.waitUntil(
          a.delete(l).catch((x) => {
            T(t, "cache: failed to delete entry:", x);
          })
        );
        const v = new Headers(
          "response" in u ? u.response.headers : u.headers
        );
        return d && v.set("X-ISR-Status", "SKIP"), v.set("Cache-Control", "no-store"), new Response("response" in u ? u.response.body : u.body, {
          status: "response" in u ? u.response.status : u.status,
          headers: v
        });
      }
      const h = "response" in u ? u.response.status : u.status;
      if (!w(h)) {
        A(t, "cache: skipping cache for status", h, "on", l);
        const v = new Headers(
          "response" in u ? u.response.headers : u.headers
        );
        return d && v.set("X-ISR-Status", "MISS"), new Response("response" in u ? u.response.body : u.body, {
          status: h,
          headers: v
        });
      }
      let I, S;
      if ("response" in u) {
        I = await u.response.text(), S = {};
        for (const [v, x] of u.response.headers.entries())
          S[v] = x;
      } else {
        const v = u;
        if (I = v.body, S = {}, v.headers instanceof Headers)
          for (const [x, g] of v.headers.entries())
            S[x] = g;
        else if (v.headers)
          for (const [x, g] of Object.entries(v.headers))
            S[x] = g;
      }
      const L = {
        body: I,
        status: h,
        headers: S,
        tags: b.tags
      }, $ = Date.now(), H = J({
        result: L,
        routeConfig: b,
        revalidateSeconds: y,
        now: $,
        logger: t
      });
      return A(t, "cache: storing entry for", l, "revalidate:", y), k.waitUntil(
        (async () => {
          await Promise.all([
            a.put(l, H),
            W({
              tagIndex: n,
              tags: H.metadata.tags,
              key: l,
              logger: t
            })
          ]);
        })().catch((v) => {
          G(t, "cache: failed to persist entry:", v);
        })
      ), z(E(H, "MISS", t, { exposeHeaders: d }));
    },
    revalidatePath: _.revalidatePath,
    revalidateTag: _.revalidateTag,
    scope(u) {
      const { request: f } = u ?? {};
      let b = null, k = null, p = null;
      if (f && e.routes) {
        const l = new URL(f.url), y = ce(l.pathname, e.routes);
        y && (p = y.config);
      }
      return {
        // Proxy ISRInstance methods through closure
        handleRequest: (l) => C.handleRequest(l),
        lookup: (l) => C.lookup(l),
        cache: (l) => C.cache(l),
        revalidatePath: (l) => C.revalidatePath(l),
        revalidateTag: (l) => C.revalidateTag(l),
        scope: (l) => C.scope(l),
        defaults(l) {
          b = l;
        },
        set(l) {
          k = l;
        },
        resolveConfig() {
          const l = [p, b, k].filter(
            (S) => S !== null
          );
          if (l.length === 0) return null;
          let y;
          const h = [];
          for (const S of l)
            S.revalidate !== void 0 && (y = S.revalidate), S.tags && h.push(...S.tags);
          const I = [...new Set(h)];
          return {
            revalidate: y,
            tags: I.length > 0 ? I : void 0
          };
        }
      };
    }
  };
  return C;
}
export {
  X as I,
  Qe as a,
  et as c,
  he as d,
  xe as n,
  Ze as r
};
