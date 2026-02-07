import { describe, it, expect, beforeEach } from "vitest";
import { createL1CacheApi } from "../../src/cache/l1-cache-api.ts";
import { cacheApiUrl } from "../../src/keys.ts";
import type { CacheEntry } from "../../src/types.ts";

describe("createL1CacheApi", () => {
  const CACHE_NAME = "test-l1";

  beforeEach(async () => {
    // Clean up by deleting test cache entries
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheApiUrl("/blog/hello"));
    await cache.delete(cacheApiUrl("/old-page"));
    await cache.delete(cacheApiUrl("/page"));
  });

  function makeFreshEntry(): CacheEntry {
    const now = Date.now();
    return {
      body: "<html>fresh</html>",
      headers: { "content-type": "text/html" },
      metadata: {
        createdAt: now,
        revalidateAfter: now + 60_000, // 60s in the future
        status: 200,
        tags: ["blog"],
      },
    };
  }

  function makeStaleEntry(): CacheEntry {
    const now = Date.now();
    return {
      body: "<html>stale</html>",
      headers: { "content-type": "text/html" },
      metadata: {
        createdAt: now - 120_000,
        revalidateAfter: now - 1_000, // 1s in the past
        status: 200,
        tags: [],
      },
    };
  }

  it("returns MISS when cache is empty", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const result = await l1.get("/blog/hello");
    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("returns HIT after put with revalidateAfter in the future", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const entry = makeFreshEntry();

    await l1.put("/blog/hello", entry);
    const result = await l1.get("/blog/hello");

    expect(result.status).toBe("HIT");
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>fresh</html>");
    expect(result.entry!.metadata.tags).toEqual(["blog"]);
  });

  it("treats null revalidateAfter as HIT", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const entry = makeFreshEntry();
    entry.metadata.revalidateAfter = null;

    await l1.put("/page", entry);
    const result = await l1.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry!.metadata.revalidateAfter).toBeNull();
  });

  it("returns STALE when revalidateAfter is in the past", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const entry = makeStaleEntry();

    // Manually put a stale entry into the cache (bypass s-maxage=0 eviction
    // by writing directly to the real Cache API with a long TTL)
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      cacheApiUrl("/old-page"),
      new Response(JSON.stringify(entry), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "s-maxage=3600",
        },
      }),
    );

    const result = await l1.get("/old-page");
    expect(result.status).toBe("STALE");
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>stale</html>");
  });

  it("uses Math.ceil for TTL with minimum 1 second", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const now = Date.now();
    const entry: CacheEntry = {
      body: "<html>short-ttl</html>",
      headers: { "content-type": "text/html" },
      metadata: {
        createdAt: now,
        revalidateAfter: now + 500, // 500ms remaining = 0.5s
        status: 200,
        tags: [],
      },
    };

    // With Math.ceil, 500ms should round up to 1s (and min is 1), so the entry survives
    await l1.put("/page", entry);
    const result = await l1.get("/page");

    // Entry should be retrievable (not evicted by s-maxage=0)
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>short-ttl</html>");
  });

  it("delete removes the entry", async () => {
    const l1 = createL1CacheApi(CACHE_NAME);
    const entry = makeFreshEntry();

    await l1.put("/page", entry);
    const before = await l1.get("/page");
    expect(before.status).toBe("HIT");

    await l1.delete("/page");
    const after = await l1.get("/page");
    expect(after.status).toBe("MISS");
    expect(after.entry).toBeNull();
  });
});
