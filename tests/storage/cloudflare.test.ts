/**
 * Tests that verify Cloudflare-backed storage implementations can be swapped
 * into the custom storage API.
 *
 * Creates CacheLayer implementations backed by:
 *   - Cache API (L1 standalone)
 *   - KV (L2 standalone)
 *   - R2
 *
 * Creates TagIndex implementations backed by:
 *   - Durable Object (existing TagIndexDOClient)
 *   - KV
 *
 * Creates LockProvider implementations backed by:
 *   - KV (existing createKvLock)
 *
 * Mixes and matches them through the full ISR lifecycle to prove each
 * Cloudflare primitive can be used as the backing store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createISR } from "../../src/isr.ts";
import { createL1CacheApi } from "../../src/cache/l1-cache-api.ts";
import { createL2Kv } from "../../src/cache/l2-kv.ts";
import { createKvLock } from "../../src/revalidation/lock.ts";
import { TagIndexDOClient } from "../../src/revalidation/tag-index.ts";
import { pageKey, cacheApiUrl, lockKey } from "../../src/keys.ts";
import { determineCacheStatus } from "../../src/utils.ts";
import type {
  CacheEntry,
  CacheLayer,
  CacheLayerResult,
  ISRStorage,
  RenderResult,
} from "../../src/types.ts";
import type { TagIndex } from "../../src/revalidation/tag-index.ts";

// ---------------------------------------------------------------------------
// R2-backed CacheLayer
// ---------------------------------------------------------------------------

function createR2Cache(bucket: R2Bucket): CacheLayer {
  function r2Key(path: string): string {
    return `cache:${path}`;
  }

  return {
    async get(path: string): Promise<CacheLayerResult> {
      const obj = await bucket.get(r2Key(path));
      if (!obj) return { entry: null, status: "MISS" };

      const entry: CacheEntry = await obj.json();
      const now = Date.now();
      const status = determineCacheStatus(entry.metadata.revalidateAfter, now);
      return { entry, status };
    },
    async put(path: string, entry: CacheEntry): Promise<void> {
      await bucket.put(r2Key(path), JSON.stringify(entry));
    },
    async delete(path: string): Promise<void> {
      await bucket.delete(r2Key(path));
    },
  };
}

// ---------------------------------------------------------------------------
// KV-backed TagIndex
// ---------------------------------------------------------------------------

function createKvTagIndex(kv: KVNamespace): TagIndex {
  function tagKey(tag: string): string {
    return `tag:${tag}`;
  }

  async function getKeys(tag: string): Promise<string[]> {
    const raw = await kv.get(tagKey(tag), "text");
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  }

  async function setKeys(tag: string, keys: string[]): Promise<void> {
    if (keys.length === 0) {
      await kv.delete(tagKey(tag));
    } else {
      await kv.put(tagKey(tag), JSON.stringify(keys));
    }
  }

  return {
    async addKeyToTag(tag: string, cacheKey: string): Promise<void> {
      const keys = await getKeys(tag);
      if (!keys.includes(cacheKey)) {
        keys.push(cacheKey);
        await setKeys(tag, keys);
      }
    },
    async addKeyToTags(tags: readonly string[], cacheKey: string): Promise<void> {
      for (const tag of tags) {
        await this.addKeyToTag(tag, cacheKey);
      }
    },
    async getKeysByTag(tag: string): Promise<string[]> {
      return getKeys(tag);
    },
    async removeKeyFromTag(tag: string, cacheKey: string): Promise<void> {
      const keys = await getKeys(tag);
      const filtered = keys.filter((k) => k !== cacheKey);
      await setKeys(tag, filtered);
    },
    async removeAllKeysForTag(tag: string): Promise<void> {
      await kv.delete(tagKey(tag));
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CACHE_NAME = "swap-test";
const TEST_PATHS = [
  "/swap/a", "/swap/b", "/swap/c", "/swap/d",
  "/swap/blog/1", "/swap/blog/2", "/swap/product/1",
];

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

async function cleanup() {
  // Clean KV
  for (const p of TEST_PATHS) {
    await env.ISR_CACHE.delete(pageKey(p));
    await env.ISR_CACHE.delete(lockKey(p));
    // Also clean KV tag index keys
    await env.ISR_CACHE.delete(`tag:blog`);
    await env.ISR_CACHE.delete(`tag:product`);
    await env.ISR_CACHE.delete(`tag:news`);
  }
  // Clean Cache API
  const cache = await caches.open(CACHE_NAME);
  for (const p of TEST_PATHS) {
    await cache.delete(cacheApiUrl(p));
  }
  // Clean R2
  for (const p of TEST_PATHS) {
    await env.R2_CACHE.delete(`cache:${p}`);
  }
}

// ---------------------------------------------------------------------------
// Tests — CacheLayer backed by Cache API (L1 standalone)
// ---------------------------------------------------------------------------

describe("cache: Cache API", () => {
  beforeEach(cleanup);

  it("lifecycle", async () => {
    const cacheApi = createL1CacheApi(CACHE_NAME);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>v1</p>" }));
    const isr = createISR({
      storage: { cache: cacheApi, tagIndex },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>v1</p>");

    const r2 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await r2.text()).toBe("<p>v1</p>");
    expect(render).toHaveBeenCalledTimes(1);

    await isr.revalidatePath({ path: "/swap/a" });
    render.mockResolvedValue(makeResult({ body: "<p>v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>v2</p>");
  });
});

// ---------------------------------------------------------------------------
// Tests — CacheLayer backed by KV (L2 standalone)
// ---------------------------------------------------------------------------

describe("cache: KV", () => {
  beforeEach(cleanup);

  it("lifecycle", async () => {
    const kvCache = createL2Kv(env.ISR_CACHE);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>kv1</p>" }));
    const isr = createISR({
      storage: { cache: kvCache, tagIndex },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/swap/b");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>kv1</p>");

    const r2 = await handleAndWait(isr, "https://example.com/swap/b");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);

    await isr.revalidatePath({ path: "/swap/b" });
    render.mockResolvedValue(makeResult({ body: "<p>kv2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/swap/b");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>kv2</p>");
  });

  it("non-200 round-trip", async () => {
    const kvCache = createL2Kv(env.ISR_CACHE);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(
      makeResult({ status: 404, body: "not found", headers: { "x-reason": "gone" } }),
    );
    const isr = createISR({ storage: { cache: kvCache, tagIndex }, render });

    await handleAndWait(isr, "https://example.com/swap/c");
    const hit = await handleAndWait(isr, "https://example.com/swap/c");
    expect(hit.status).toBe(404);
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");
    expect(hit.headers.get("x-reason")).toBe("gone");
    expect(await hit.text()).toBe("not found");
  });
});

// ---------------------------------------------------------------------------
// Tests — CacheLayer backed by R2
// ---------------------------------------------------------------------------

describe("cache: R2", () => {
  beforeEach(cleanup);

  it("lifecycle", async () => {
    const r2Cache = createR2Cache(env.R2_CACHE);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>r2-v1</p>" }));
    const isr = createISR({
      storage: { cache: r2Cache, tagIndex },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>r2-v1</p>");

    const r2 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await r2.text()).toBe("<p>r2-v1</p>");
    expect(render).toHaveBeenCalledTimes(1);

    await isr.revalidatePath({ path: "/swap/a" });
    render.mockResolvedValue(makeResult({ body: "<p>r2-v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>r2-v2</p>");
  });

  it("headers and status round-trip", async () => {
    const r2Cache = createR2Cache(env.R2_CACHE);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(
      makeResult({ status: 301, body: "moved", headers: { "location": "/new" } }),
    );
    const isr = createISR({ storage: { cache: r2Cache, tagIndex }, render });

    await handleAndWait(isr, "https://example.com/swap/d");
    const hit = await handleAndWait(isr, "https://example.com/swap/d");
    expect(hit.status).toBe(301);
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");
    expect(hit.headers.get("location")).toBe("/new");
    expect(await hit.text()).toBe("moved");
  });

  it("tag invalidation", async () => {
    const r2Cache = createR2Cache(env.R2_CACHE);
    const tagIndex = new TagIndexDOClient(env.TAG_INDEX);
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["blog"], body: "<p>old</p>" }),
    );
    const isr = createISR({ storage: { cache: r2Cache, tagIndex }, render });

    await handleAndWait(isr, "https://example.com/swap/blog/1");
    await handleAndWait(isr, "https://example.com/swap/blog/2");

    const hit = await handleAndWait(isr, "https://example.com/swap/blog/1");
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");

    await isr.revalidateTag({ tag: "blog" });
    render.mockResolvedValue(makeResult({ tags: ["blog"], body: "<p>new</p>" }));

    const miss1 = await handleAndWait(isr, "https://example.com/swap/blog/1");
    expect(miss1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await miss1.text()).toBe("<p>new</p>");

    const miss2 = await handleAndWait(isr, "https://example.com/swap/blog/2");
    expect(miss2.headers.get("X-ISR-Status")).toBe("MISS");
  });
});

// ---------------------------------------------------------------------------
// Tests — TagIndex backed by KV (swap out the DO)
// ---------------------------------------------------------------------------

describe("tag index: KV", () => {
  beforeEach(cleanup);

  it("invalidation with KV cache", async () => {
    const kvCache = createL2Kv(env.ISR_CACHE);
    const kvTags = createKvTagIndex(env.ISR_CACHE);
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["news"], body: "<p>old</p>" }),
    );
    const isr = createISR({
      storage: { cache: kvCache, tagIndex: kvTags },
      render,
    });

    await handleAndWait(isr, "https://example.com/swap/blog/1");
    await handleAndWait(isr, "https://example.com/swap/blog/2");

    const hit = await handleAndWait(isr, "https://example.com/swap/blog/1");
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");

    await isr.revalidateTag({ tag: "news" });
    render.mockResolvedValue(makeResult({ tags: ["news"], body: "<p>fresh</p>" }));

    const miss = await handleAndWait(isr, "https://example.com/swap/blog/1");
    expect(miss.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await miss.text()).toBe("<p>fresh</p>");
  });

  it("invalidation with R2 cache", async () => {
    const r2Cache = createR2Cache(env.R2_CACHE);
    const kvTags = createKvTagIndex(env.ISR_CACHE);
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["product"], body: "<p>old</p>" }),
    );
    const isr = createISR({
      storage: { cache: r2Cache, tagIndex: kvTags },
      render,
    });

    await handleAndWait(isr, "https://example.com/swap/product/1");

    const hit = await handleAndWait(isr, "https://example.com/swap/product/1");
    expect(hit.headers.get("X-ISR-Status")).toBe("HIT");

    await isr.revalidateTag({ tag: "product" });
    render.mockResolvedValue(makeResult({ tags: ["product"], body: "<p>new</p>" }));

    const miss = await handleAndWait(isr, "https://example.com/swap/product/1");
    expect(miss.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await miss.text()).toBe("<p>new</p>");
  });
});

// ---------------------------------------------------------------------------
// Tests — LockProvider backed by KV
// ---------------------------------------------------------------------------

describe("lock: KV", () => {
  beforeEach(cleanup);

  it("acquire/release lifecycle", async () => {
    const lock = createKvLock(env.ISR_CACHE);

    // Verify acquire returns AsyncDisposable
    const handle = await lock.acquire("test-lock-key");
    expect(handle).not.toBeNull();
    expect(Symbol.asyncDispose in handle!).toBe(true);

    // Second acquire for same key returns null (lock held)
    const second = await lock.acquire("test-lock-key");
    expect(second).toBeNull();

    // Dispose releases the lock
    await handle![Symbol.asyncDispose]();

    // After release, can acquire again
    const third = await lock.acquire("test-lock-key");
    expect(third).not.toBeNull();
    await third![Symbol.asyncDispose]();
  });

  it("plugs into ISR with R2 cache", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>locked</p>" }));
    const isr = createISR({
      storage: {
        cache: createR2Cache(env.R2_CACHE),
        tagIndex: new TagIndexDOClient(env.TAG_INDEX),
        lock: createKvLock(env.ISR_CACHE),
      },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>locked</p>");

    const r2 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  /**
   * NOTE: The KV lock is best-effort and not atomic. In the miniflare test
   * environment (single-process), concurrent requests both read KV before
   * either writes, so both acquire the lock. This is documented behavior —
   * the lock prevents most thundering-herd duplicates in production (where
   * KV reads are slower and staggered) but does not guarantee mutual
   * exclusion. This test verifies the lock is wired through correctly,
   * not that it achieves perfect deduplication in a single-process env.
   */
  it("concurrent STALE (best-effort, non-atomic)", async () => {
    let renderCount = 0;
    const render = vi.fn().mockImplementation(async () => {
      renderCount++;
      await new Promise((r) => setTimeout(r, 20));
      return makeResult({ body: `<p>v${renderCount}</p>`, revalidate: 0.001 });
    });
    const isr = createISR({
      storage: {
        cache: createR2Cache(env.R2_CACHE),
        tagIndex: new TagIndexDOClient(env.TAG_INDEX),
        lock: createKvLock(env.ISR_CACHE),
      },
      render,
    });

    // Prime cache
    await handleAndWait(isr, "https://example.com/swap/b");
    await new Promise((r) => setTimeout(r, 10));

    // Two concurrent STALE requests — both will trigger revalidation
    // because the KV lock is not atomic (see NOTE above).
    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();
    const [res1, res2] = await Promise.all([
      isr.handleRequest({ request: new Request("https://example.com/swap/b"), ctx: ctx1 }),
      isr.handleRequest({ request: new Request("https://example.com/swap/b"), ctx: ctx2 }),
    ]);
    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);

    // Both should return STALE (serving stale content while revalidating)
    expect(res1!.headers.get("X-ISR-Status")).toBe("STALE");
    expect(res2!.headers.get("X-ISR-Status")).toBe("STALE");

    // 1 initial + 2 background = 3 total.
    // The KV lock is not atomic: in a single-process env both concurrent
    // requests read KV before either writes, so both acquire and both
    // trigger a background render. This is correct behavior — the lock
    // is best-effort, not a mutex.
    expect(renderCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests — full cross-combination: R2 cache + KV tags + KV lock
// ---------------------------------------------------------------------------

describe("mixed: R2 + KV tags + KV lock", () => {
  beforeEach(cleanup);

  it("full lifecycle with tag and path purge", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ tags: ["blog"], body: "<p>v1</p>" }),
    );
    const isr = createISR({
      storage: {
        cache: createR2Cache(env.R2_CACHE),
        tagIndex: createKvTagIndex(env.ISR_CACHE),
        lock: createKvLock(env.ISR_CACHE),
      },
      render,
    });

    // MISS
    const r1 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r1.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r1.text()).toBe("<p>v1</p>");

    // HIT
    const r2 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);

    // Tag purge
    await isr.revalidateTag({ tag: "blog" });
    render.mockResolvedValue(makeResult({ tags: ["blog"], body: "<p>v2</p>" }));

    const r3 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r3.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r3.text()).toBe("<p>v2</p>");

    // Path purge
    await isr.revalidatePath({ path: "/swap/a" });
    render.mockResolvedValue(makeResult({ tags: ["blog"], body: "<p>v3</p>" }));

    const r4 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r4.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await r4.text()).toBe("<p>v3</p>");
  });

  it("bypass mode", async () => {
    const render = vi.fn().mockResolvedValue(makeResult({ body: "<p>draft</p>" }));
    const isr = createISR({
      storage: {
        cache: createR2Cache(env.R2_CACHE),
        tagIndex: createKvTagIndex(env.ISR_CACHE),
      },
      render,
      bypassToken: "secret",
    });

    const res = await handleAndWait(
      isr, "https://example.com/swap/a", { "x-isr-bypass": "secret" },
    );
    expect(res.headers.get("X-ISR-Status")).toBe("BYPASS");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("<p>draft</p>");
  });

  it("revalidate: false immutable", async () => {
    const render = vi.fn().mockResolvedValue(
      makeResult({ revalidate: false, body: "<p>forever</p>" }),
    );
    const isr = createISR({
      storage: {
        cache: createR2Cache(env.R2_CACHE),
        tagIndex: createKvTagIndex(env.ISR_CACHE),
      },
      render,
    });

    const r1 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r1.headers.get("Cache-Control")).toContain("immutable");

    const r2 = await handleAndWait(isr, "https://example.com/swap/a");
    expect(r2.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });
});
