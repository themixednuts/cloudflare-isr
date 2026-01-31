import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createL2Kv } from "./l2-kv.ts";
import { pageKey } from "../keys.ts";
import type { CacheEntry } from "../types.ts";

describe("createL2Kv", () => {
  beforeEach(async () => {
    // Clean up KV keys used by tests
    await env.ISR_CACHE.delete(pageKey("/blog/hello"));
    await env.ISR_CACHE.delete(pageKey("/old-page"));
    await env.ISR_CACHE.delete(pageKey("/page"));
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
});
