/**
 * Tests that verify each component of the custom storage API can be
 * independently swapped without breaking the ISR lifecycle.
 *
 * Two distinct implementations per interface (CacheLayer, TagIndex,
 * LockProvider), tested individually and in cross-combinations.
 * No Cloudflare bindings — pure in-memory.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createISR } from "../../src/isr.ts";
import type {
  CacheEntry,
  CacheLayer,
  CacheLayerResult,
  ISRStorage,
  LockProvider,
  RenderResult,
} from "../../src/types.ts";
import type { TagIndex } from "../../src/revalidation/tag-index.ts";

// ---------------------------------------------------------------------------
// CacheLayer implementation A — Map-based
// ---------------------------------------------------------------------------

function createMapCache(): CacheLayer {
  const store = new Map<string, CacheEntry>();

  return {
    async get(path: string): Promise<CacheLayerResult> {
      const entry = store.get(path);
      if (!entry) return { entry: null, status: "MISS" };
      const now = Date.now();
      if (
        entry.metadata.revalidateAfter !== null &&
        now >= entry.metadata.revalidateAfter
      ) {
        return { entry, status: "STALE" };
      }
      return { entry, status: "HIT" };
    },
    async put(path: string, entry: CacheEntry): Promise<void> {
      store.set(path, entry);
    },
    async delete(path: string): Promise<void> {
      store.delete(path);
    },
  };
}

// ---------------------------------------------------------------------------
// CacheLayer implementation B — plain object record (simulates a DB/KV)
// ---------------------------------------------------------------------------

function createObjectCache(): CacheLayer {
  const store: Record<string, string> = {}; // JSON-serialized entries

  return {
    async get(path: string): Promise<CacheLayerResult> {
      const raw = store[path];
      if (!raw) return { entry: null, status: "MISS" };
      const entry: CacheEntry = JSON.parse(raw);
      const now = Date.now();
      if (
        entry.metadata.revalidateAfter !== null &&
        now >= entry.metadata.revalidateAfter
      ) {
        return { entry, status: "STALE" };
      }
      return { entry, status: "HIT" };
    },
    async put(path: string, entry: CacheEntry): Promise<void> {
      store[path] = JSON.stringify(entry);
    },
    async delete(path: string): Promise<void> {
      delete store[path];
    },
  };
}

// ---------------------------------------------------------------------------
// TagIndex implementation A — Map<string, Set<string>>
// ---------------------------------------------------------------------------

function createSetTagIndex(): TagIndex {
  const index = new Map<string, Set<string>>();

  return {
    async addKeyToTag(tag: string, cacheKey: string): Promise<void> {
      if (!index.has(tag)) index.set(tag, new Set());
      index.get(tag)!.add(cacheKey);
    },
    async addKeyToTags(tags: readonly string[], cacheKey: string): Promise<void> {
      for (const tag of tags) {
        if (!index.has(tag)) index.set(tag, new Set());
        index.get(tag)!.add(cacheKey);
      }
    },
    async getKeysByTag(tag: string): Promise<string[]> {
      return [...(index.get(tag) ?? [])];
    },
    async removeKeyFromTag(tag: string, cacheKey: string): Promise<void> {
      index.get(tag)?.delete(cacheKey);
    },
    async removeAllKeysForTag(tag: string): Promise<void> {
      index.delete(tag);
    },
  };
}

// ---------------------------------------------------------------------------
// TagIndex implementation B — flat array pairs (simulates a relational table)
// ---------------------------------------------------------------------------

function createArrayTagIndex(): TagIndex {
  const rows: Array<{ tag: string; cacheKey: string }> = [];

  return {
    async addKeyToTag(tag: string, cacheKey: string): Promise<void> {
      if (!rows.some((r) => r.tag === tag && r.cacheKey === cacheKey)) {
        rows.push({ tag, cacheKey });
      }
    },
    async addKeyToTags(tags: readonly string[], cacheKey: string): Promise<void> {
      for (const tag of tags) {
        if (!rows.some((r) => r.tag === tag && r.cacheKey === cacheKey)) {
          rows.push({ tag, cacheKey });
        }
      }
    },
    async getKeysByTag(tag: string): Promise<string[]> {
      return rows.filter((r) => r.tag === tag).map((r) => r.cacheKey);
    },
    async removeKeyFromTag(tag: string, cacheKey: string): Promise<void> {
      const idx = rows.findIndex((r) => r.tag === tag && r.cacheKey === cacheKey);
      if (idx !== -1) rows.splice(idx, 1);
    },
    async removeAllKeysForTag(tag: string): Promise<void> {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]!.tag === tag) rows.splice(i, 1);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LockProvider implementation A — Set-based mutex
// ---------------------------------------------------------------------------

function createSetLock(): LockProvider {
  const held = new Set<string>();

  return {
    async acquire(key: string): Promise<AsyncDisposable | null> {
      if (held.has(key)) return null;
      held.add(key);
      return {
        async [Symbol.asyncDispose]() {
          held.delete(key);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// LockProvider implementation B — Promise-based semaphore
// ---------------------------------------------------------------------------

function createSemaphoreLock(): LockProvider {
  const locks = new Map<string, Promise<void>>();

  return {
    async acquire(key: string): Promise<AsyncDisposable | null> {
      if (locks.has(key)) return null;
      let releaseFn!: () => void;
      const promise = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      locks.set(key, promise);
      return {
        async [Symbol.asyncDispose]() {
          locks.delete(key);
          releaseFn();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<RenderResult>): RenderResult {
  return {
    body: "<html>Hello</html>",
    status: 200,
    headers: { "content-type": "text/html" },
    tags: [],
    ...overrides,
  };
}

async function handleAndWait(
  isr: ReturnType<typeof createISR>,
  url: string,
  headers?: Record<string, string>,
) {
  const ctx = createExecutionContext();
  const res = await isr.handleRequest({
    request: new Request(url, headers ? { headers } : undefined),
    ctx,
  });
  await waitOnExecutionContext(ctx);
  return res!;
}

// ---------------------------------------------------------------------------
// Tests — swap CacheLayer independently
// ---------------------------------------------------------------------------

describe("swap CacheLayer", () => {
  it("Map-based cache: MISS → HIT → purge → MISS lifecycle", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>v1</p>" }));
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createSetTagIndex() },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>v1</p>");

    const r2 = await handleAndWait(isr, "https://example.com/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await r2.text()).toBe("<p>v1</p>");
    expect(render).toHaveBeenCalledTimes(1);

    await isr.revalidatePath({ path: "/a" });
    render.mockResolvedValue(makeResult({ body: "<p>v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/a");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>v2</p>");
  });

  it("Object-based cache: MISS → HIT → purge → MISS lifecycle", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>v1</p>" }));
    const isr = createISR({
      storage: { cache: createObjectCache(), tagIndex: createSetTagIndex() },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>v1</p>");

    const r2 = await handleAndWait(isr, "https://example.com/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await r2.text()).toBe("<p>v1</p>");
    expect(render).toHaveBeenCalledTimes(1);

    await isr.revalidatePath({ path: "/a" });
    render.mockResolvedValue(makeResult({ body: "<p>v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/a");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>v2</p>");
  });

  it("Object-based cache preserves headers and status through JSON round-trip", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ status: 404, body: "gone", headers: { "x-custom": "yes" } }),
    );
    const isr = createISR({
      storage: { cache: createObjectCache(), tagIndex: createSetTagIndex() },
      render,
    });

    await handleAndWait(isr, "https://example.com/missing");

    const hit = await handleAndWait(isr, "https://example.com/missing");
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");
    expect(hit.status).toBe(404);
    expect(await hit.text()).toBe("gone");
    expect(hit.headers.get("x-custom")).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// Tests — swap TagIndex independently
// ---------------------------------------------------------------------------

describe("swap TagIndex", () => {
  it("Set-based tag index: tag invalidation purges all tagged pages", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["blog"], body: "<p>old</p>" }),
    );
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createSetTagIndex() },
      render,
    });

    await handleAndWait(isr, "https://example.com/blog/a");
    await handleAndWait(isr, "https://example.com/blog/b");

    const hitA = await handleAndWait(isr, "https://example.com/blog/a");
    const hitB = await handleAndWait(isr, "https://example.com/blog/b");
    expect(hitA.headers.get("X-ISR-Status")).toBe("HIT");
    expect(hitB.headers.get("X-ISR-Status")).toBe("HIT");

    await isr.revalidateTag({ tag: "blog" });
    render.mockResolvedValue(makeResult({ tags: ["blog"], body: "<p>new</p>" }));

    const missA = await handleAndWait(isr, "https://example.com/blog/a");
    expect(missA.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await missA.text()).toBe("<p>new</p>");

    const missB = await handleAndWait(isr, "https://example.com/blog/b");
    expect(missB.headers.get("X-ISR-Status")).toBe("MISS");
  });

  it("Array-based tag index: tag invalidation purges all tagged pages", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["news"], body: "<p>old</p>" }),
    );
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createArrayTagIndex() },
      render,
    });

    await handleAndWait(isr, "https://example.com/news/1");
    await handleAndWait(isr, "https://example.com/news/2");

    const hit1 = await handleAndWait(isr, "https://example.com/news/1");
    const hit2 = await handleAndWait(isr, "https://example.com/news/2");
    expect(hit1.headers.get("X-ISR-Status")).toBe("HIT");
    expect(hit2.headers.get("X-ISR-Status")).toBe("HIT");

    await isr.revalidateTag({ tag: "news" });
    render.mockResolvedValue(makeResult({ tags: ["news"], body: "<p>fresh</p>" }));

    const miss1 = await handleAndWait(isr, "https://example.com/news/1");
    expect(miss1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await miss1.text()).toBe("<p>fresh</p>");

    const miss2 = await handleAndWait(isr, "https://example.com/news/2");
    expect(miss2.headers.get("X-ISR-Status")).toBe("MISS");
  });

  it("Array-based tag index: unrelated tags are not affected", async () => {
    let callCount = 0;
    const render = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResult({
        tags: callCount <= 1 ? ["blog"] : ["docs"],
        body: `<p>${callCount}</p>`,
      });
    });
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createArrayTagIndex() },
      render,
    });

    await handleAndWait(isr, "https://example.com/blog/a");
    await handleAndWait(isr, "https://example.com/docs/x");

    // Purge only "blog"
    await isr.revalidateTag({ tag: "blog" });

    const blogRes = await handleAndWait(isr, "https://example.com/blog/a");
    expect(blogRes.headers.get("X-ISR-Status")).toBe("MISS");

    const docsRes = await handleAndWait(isr, "https://example.com/docs/x");
    expect(docsRes.headers.get("X-ISR-Status")).toBe("HIT");
  });
});

// ---------------------------------------------------------------------------
// Tests — swap LockProvider independently
// ---------------------------------------------------------------------------

describe("swap LockProvider", () => {
  it("Set-based lock prevents concurrent revalidation", async () => {
    let renderCount = 0;
    const render = vi.fn().mockImplementation(async () => {
      renderCount++;
      await new Promise((r) => setTimeout(r, 20));
      return makeResult({ body: `<p>v${renderCount}</p>`, revalidate: 0.001 });
    });
    const isr = createISR({
      storage: {
        cache: createMapCache(),
        tagIndex: createSetTagIndex(),
        lock: createSetLock(),
      },
      render,
    });

    // Prime
    await handleAndWait(isr, "https://example.com/page");
    await new Promise((r) => setTimeout(r, 10));

    // Two concurrent STALE requests
    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();
    await Promise.all([
      isr.handleRequest({ request: new Request("https://example.com/page"), ctx: ctx1 }),
      isr.handleRequest({ request: new Request("https://example.com/page"), ctx: ctx2 }),
    ]);
    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);

    expect(renderCount).toBeLessThanOrEqual(2);
  });

  it("Semaphore-based lock prevents concurrent revalidation", async () => {
    let renderCount = 0;
    const render = vi.fn().mockImplementation(async () => {
      renderCount++;
      await new Promise((r) => setTimeout(r, 20));
      return makeResult({ body: `<p>v${renderCount}</p>`, revalidate: 0.001 });
    });
    const isr = createISR({
      storage: {
        cache: createMapCache(),
        tagIndex: createSetTagIndex(),
        lock: createSemaphoreLock(),
      },
      render,
    });

    // Prime
    await handleAndWait(isr, "https://example.com/page");
    await new Promise((r) => setTimeout(r, 10));

    // Two concurrent STALE requests
    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();
    await Promise.all([
      isr.handleRequest({ request: new Request("https://example.com/page"), ctx: ctx1 }),
      isr.handleRequest({ request: new Request("https://example.com/page"), ctx: ctx2 }),
    ]);
    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);

    expect(renderCount).toBeLessThanOrEqual(2);
  });

  it("no lock provider: ISR still works (no deduplication)", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>ok</p>" }));
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createSetTagIndex() },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/page");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");

    const r2 = await handleAndWait(isr, "https://example.com/page");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await r2.text()).toBe("<p>ok</p>");
  });
});

// ---------------------------------------------------------------------------
// Tests — cross-combination swaps
// ---------------------------------------------------------------------------

describe("mixed implementations", () => {
  it("Object cache + Array tag index + Semaphore lock: full lifecycle", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["product"], body: "<p>v1</p>" }),
    );
    const isr = createISR({
      storage: {
        cache: createObjectCache(),
        tagIndex: createArrayTagIndex(),
        lock: createSemaphoreLock(),
      },
      render,
    });

    // MISS → cache
    const r1 = await handleAndWait(isr, "https://example.com/product/1");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>v1</p>");

    // HIT from cache
    const r2 = await handleAndWait(isr, "https://example.com/product/1");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);

    // Tag purge
    await isr.revalidateTag({ tag: "product" });
    render.mockResolvedValue(makeResult({ tags: ["product"], body: "<p>v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/product/1");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>v2</p>");

    // Path purge
    await isr.revalidatePath({ path: "/product/1" });
    render.mockResolvedValue(makeResult({ tags: ["product"], body: "<p>v3</p>" }));

    const r4 = await handleAndWait(isr, "https://example.com/product/1");
    expect(r4.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r4.text()).toBe("<p>v3</p>");
  });

  it("Map cache + Array tag index + Set lock: bypass mode", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>draft</p>" }));
    const isr = createISR({
      storage: {
        cache: createMapCache(),
        tagIndex: createArrayTagIndex(),
        lock: createSetLock(),
      },
      render,
      bypassToken: "tok",
    });

    const res = await handleAndWait(
      isr, "https://example.com/preview", { "x-isr-bypass": "tok" },
    );
    expect(res.headers.get("X-ISR-Status")).toBe("BYPASS");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("<p>draft</p>");
  });

  it("Object cache + Set tag index: revalidate false stores immutable", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ revalidate: false, body: "<p>forever</p>" }),
    );
    const isr = createISR({
      storage: { cache: createObjectCache(), tagIndex: createSetTagIndex() },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/static");
    expect(r1.headers.get("Cache-Control")).toContain("immutable");

    const r2 = await handleAndWait(isr, "https://example.com/static");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("Object cache + Array tag index: revalidate 0 skips cache", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ revalidate: 0, body: "<p>dynamic</p>" }),
    );
    const isr = createISR({
      storage: { cache: createObjectCache(), tagIndex: createArrayTagIndex() },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/api");
    expect(r1.headers.get("X-ISR-Status")).toBe("SKIP");

    await handleAndWait(isr, "https://example.com/api");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("Map cache + Array tag index: multi-tag pages only invalidate matching tag", async () => {
    let callCount = 0;
    const render = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResult({
        tags: ["blog", "featured"],
        body: `<p>render-${callCount}</p>`,
      });
    });
    const isr = createISR({
      storage: { cache: createMapCache(), tagIndex: createArrayTagIndex() },
      render,
    });

    await handleAndWait(isr, "https://example.com/post/1");

    const hit = await handleAndWait(isr, "https://example.com/post/1");
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");

    // Invalidate only "featured" — the page has both tags, so it gets purged
    await isr.revalidateTag({ tag: "featured" });

    const miss = await handleAndWait(isr, "https://example.com/post/1");
    expect(miss.headers.get("X-ISR-Status")).toBe("MISS");
  });
});
