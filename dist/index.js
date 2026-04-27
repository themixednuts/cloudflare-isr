var l = Object.defineProperty;
var u = (s, e, n) => e in s ? l(s, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : s[e] = n;
var E = (s, e, n) => u(s, typeof e != "symbol" ? e + "" : e, n);
import { I as m, c as p, d as N, n as x, r as L } from "./isr-Dx83Ykr2.js";
const y = 2048, R = 64, i = 1e4;
class o extends Error {
  constructor(e) {
    super(e), this.name = "ValidationError";
  }
}
function T(s, e) {
  if (!s || s.length === 0)
    throw new o(`${e} must not be empty`);
}
function w(s, e) {
  if (s.length > y)
    throw new o(
      `${e} exceeds maximum length of ${y}`
    );
}
function r(s, e) {
  T(s, e), w(s, e);
}
async function g(s) {
  try {
    return await s.json();
  } catch {
    throw new o("Invalid JSON body");
  }
}
class k {
  constructor(e, n) {
    E(this, "sql");
    this.sql = e.storage.sql, this.sql.exec(
      `CREATE TABLE IF NOT EXISTS tag_keys (
        tag TEXT NOT NULL,
        key TEXT NOT NULL,
        PRIMARY KEY (tag, key)
      )`
    );
  }
  async fetch(e) {
    const n = new URL(e.url);
    try {
      switch (n.pathname) {
        case "/add": {
          const { tag: t, key: a } = await g(e);
          return r(t, "tag"), r(a, "key"), this.sql.exec(
            "INSERT OR IGNORE INTO tag_keys (tag, key) VALUES (?, ?)",
            t,
            a
          ), new Response("ok");
        }
        case "/add-bulk": {
          const { tags: t, key: a } = await g(e);
          if (!Array.isArray(t))
            throw new o("tags must be an array");
          if (t.length > R)
            throw new o(
              `tags array exceeds maximum length of ${R}`
            );
          r(a, "key");
          for (const c of t)
            r(c, "tag");
          for (const c of t)
            this.sql.exec(
              "INSERT OR IGNORE INTO tag_keys (tag, key) VALUES (?, ?)",
              c,
              a
            );
          return new Response("ok");
        }
        case "/get": {
          const t = n.searchParams.get("tag") ?? "";
          r(t, "tag");
          const a = this.sql.exec("SELECT key FROM tag_keys WHERE tag = ? LIMIT ?", t, i).toArray();
          a.length === i && console.warn(
            `[ISRTagIndexDO] Tag "${t.slice(0, 64)}" returned ${i} results (limit reached, results truncated)`
          );
          const c = a.map((h) => h.key);
          return Response.json(c);
        }
        case "/remove": {
          const { tag: t, key: a } = await g(e);
          return r(t, "tag"), r(a, "key"), this.sql.exec(
            "DELETE FROM tag_keys WHERE tag = ? AND key = ?",
            t,
            a
          ), new Response("ok");
        }
        case "/remove-tag": {
          const { tag: t } = await g(e);
          return r(t, "tag"), this.sql.exec("DELETE FROM tag_keys WHERE tag = ?", t), new Response("ok");
        }
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (t) {
      return t instanceof o ? new Response(t.message, { status: 400 }) : (console.error(`[ISRTagIndexDO] Error handling ${n.pathname}:`, t), new Response("Internal error", { status: 500 }));
    }
  }
}
export {
  k as ISRTagIndexDO,
  m as ISR_RENDER_HEADER,
  p as createISR,
  N as defaultCacheKey,
  x as normalizeCacheKey,
  L as renderer
};
