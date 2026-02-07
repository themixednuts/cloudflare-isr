import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { createL2Kv } from "../../src/cache/l2-kv.ts";
import { pageKey } from "../../src/keys.ts";
import type { CacheEntry } from "../../src/types.ts";

describe("createL2Kv", () => {
  beforeEach(async () => {
    // Clean up KV keys used by tests
    await env.ISR_CACHE.delete(pageKey("/blog/hello"));
    await env.ISR_CACHE.delete(pageKey("/old-page"));
    await env.ISR_CACHE.delete(pageKey("/page"));
    await env.ISR_CACHE.delete(pageKey("/big-tags"));
  });

  function makeFreshEntry(): CacheEntry {
    const now = Date.now();
    return {
      body: "<html>fresh</html>",
      headers: { "content-type": "text/html" },
      metadata: {
        createdAt: now,
        revalidateAfter: now + 60_000,
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
        revalidateAfter: now - 1_000,
        status: 200,
        tags: [],
      },
    };
  }

  it("returns MISS on empty KV", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const result = await l2.get("/blog/hello");
    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("returns HIT after put with fresh metadata", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const entry = makeFreshEntry();

    await l2.put("/blog/hello", entry);
    const result = await l2.get("/blog/hello");

    expect(result.status).toBe("HIT");
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>fresh</html>");
    expect(result.entry!.metadata.tags).toEqual(["blog"]);
  });

  it("treats null revalidateAfter as HIT", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const entry = makeFreshEntry();
    entry.metadata.revalidateAfter = null;

    await l2.put("/page", entry);
    const result = await l2.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry!.metadata.revalidateAfter).toBeNull();
  });

  it("returns STALE when revalidateAfter is past", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const entry = makeStaleEntry();

    await l2.put("/old-page", entry);
    const result = await l2.get("/old-page");

    expect(result.status).toBe("STALE");
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>stale</html>");
  });

  it("returns MISS when KV value has non-string body", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const key = pageKey("/blog/hello");
    const now = Date.now();

    // Write a malformed value directly to KV: body is a number instead of string
    await env.ISR_CACHE.put(
      key,
      JSON.stringify({ body: 12345, headers: {} }),
      {
        metadata: {
          createdAt: now,
          revalidateAfter: now + 60_000,
          status: 200,
          tags: [],
        },
      },
    );

    const result = await l2.get("/blog/hello");
    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("returns MISS when KV value has invalid headers (array)", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const key = pageKey("/blog/hello");
    const now = Date.now();

    // Write a malformed value: headers is an array instead of object
    await env.ISR_CACHE.put(
      key,
      JSON.stringify({ body: "<html>ok</html>", headers: ["bad"] }),
      {
        metadata: {
          createdAt: now,
          revalidateAfter: now + 60_000,
          status: 200,
          tags: [],
        },
      },
    );

    const result = await l2.get("/blog/hello");
    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("handles legacy plain-text KV values gracefully", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const key = pageKey("/blog/hello");
    const now = Date.now();

    // Write a legacy plain-text value (not JSON)
    await env.ISR_CACHE.put(key, "<html>legacy</html>", {
      metadata: {
        createdAt: now,
        revalidateAfter: now + 60_000,
        status: 200,
        tags: [],
      },
    });

    const result = await l2.get("/blog/hello");
    expect(result.status).toBe("HIT");
    expect(result.entry).not.toBeNull();
    expect(result.entry!.body).toBe("<html>legacy</html>");
    expect(result.entry!.headers).toEqual({});
  });

  it("delete removes the entry", async () => {
    const l2 = createL2Kv(env.ISR_CACHE);
    const entry = makeFreshEntry();

    await l2.put("/page", entry);
    const before = await l2.get("/page");
    expect(before.status).toBe("HIT");

    await l2.delete("/page");
    const after = await l2.get("/page");
    expect(after.status).toBe("MISS");
    expect(after.entry).toBeNull();
  });

  it("truncates tags when metadata exceeds 1024 bytes", async () => {
    const warn = vi.fn();
    const l2 = createL2Kv(env.ISR_CACHE, { warn });
    const now = Date.now();

    // Generate enough tags to exceed 1024 bytes of metadata
    const manyTags = Array.from({ length: 80 }, (_, i) => `tag-${i}-${"x".repeat(10)}`);
    const entry: CacheEntry = {
      body: "<html>big tags</html>",
      headers: { "content-type": "text/html" },
      metadata: {
        createdAt: now,
        revalidateAfter: now + 60_000,
        status: 200,
        tags: manyTags,
      },
    };

    // Should not throw
    await l2.put("/big-tags", entry);

    // Should have logged a warning about truncation
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("KV metadata exceeds 1024 bytes"),
    );

    // Stored entry should still be retrievable
    const result = await l2.get("/big-tags");
    expect(result.status).toBe("HIT");
    expect(result.entry).not.toBeNull();

    // Tags should be fewer than original
    expect(result.entry!.metadata.tags.length).toBeLessThan(manyTags.length);
    expect(result.entry!.metadata.tags.length).toBeGreaterThan(0);
  });

  it("does not truncate tags when metadata fits within 1024 bytes", async () => {
    const warn = vi.fn();
    const l2 = createL2Kv(env.ISR_CACHE, { warn });
    const entry = makeFreshEntry();

    await l2.put("/blog/hello", entry);

    // No warning should be logged
    expect(warn).not.toHaveBeenCalled();

    const result = await l2.get("/blog/hello");
    expect(result.entry!.metadata.tags).toEqual(["blog"]);
  });
});
