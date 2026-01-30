import { describe, it, expect, vi } from "vitest";
import { createTwoTierCache } from "./two-tier-cache.ts";
import type { CacheEntry, CacheLayer, CacheLayerResult } from "../types.ts";

function makeMockLayer(overrides?: Partial<CacheLayer>): CacheLayer {
  return {
    get: vi.fn<(path: string) => Promise<CacheLayerResult>>().mockResolvedValue({
      entry: null,
      status: "MISS",
    }),
    put: vi.fn<(path: string, entry: CacheEntry) => Promise<void>>().mockResolvedValue(undefined),
    delete: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFreshEntry(): CacheEntry {
  const now = Date.now();
  return {
    body: "<html>content</html>",
    metadata: {
      createdAt: now,
      revalidateAfter: now + 60_000,
      status: 200,
      headers: { "content-type": "text/html" },
      tags: [],
    },
  };
}

function makeStaleEntry(): CacheEntry {
  const now = Date.now();
  return {
    body: "<html>stale</html>",
    metadata: {
      createdAt: now - 120_000,
      revalidateAfter: now - 1_000,
      status: 200,
      headers: { "content-type": "text/html" },
      tags: [],
    },
  };
}

describe("createTwoTierCache", () => {
  it("returns L1 HIT when L1 has it", async () => {
    const entry = makeFreshEntry();
    const l1 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry, status: "HIT" }),
    });
    const l2 = makeMockLayer();
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry).toBe(entry);
    expect(l2.get).not.toHaveBeenCalled();
  });

  it("falls through to L2 on L1 MISS", async () => {
    const entry = makeFreshEntry();
    const l1 = makeMockLayer(); // default MISS
    const l2 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry, status: "HIT" }),
    });
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry).toBe(entry);
    expect(l1.get).toHaveBeenCalledWith("/page");
    expect(l2.get).toHaveBeenCalledWith("/page");
    expect(l1.put).toHaveBeenCalledWith("/page", entry);
  });

  it("returns MISS when both layers miss", async () => {
    const l1 = makeMockLayer();
    const l2 = makeMockLayer();
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("put writes to both layers in parallel", async () => {
    const l1 = makeMockLayer();
    const l2 = makeMockLayer();
    const cache = createTwoTierCache(l1, l2);
    const entry = makeFreshEntry();

    await cache.put("/page", entry);

    expect(l1.put).toHaveBeenCalledWith("/page", entry);
    expect(l2.put).toHaveBeenCalledWith("/page", entry);
  });

  it("delete removes from both layers in parallel", async () => {
    const l1 = makeMockLayer();
    const l2 = makeMockLayer();
    const cache = createTwoTierCache(l1, l2);

    await cache.delete("/page");

    expect(l1.delete).toHaveBeenCalledWith("/page");
    expect(l2.delete).toHaveBeenCalledWith("/page");
  });

  it("prefers L2 HIT over L1 STALE and backfills L1", async () => {
    const entry = makeStaleEntry();
    const fresh = makeFreshEntry();
    const l1 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry, status: "STALE" }),
    });
    const l2 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: fresh, status: "HIT" }),
    });
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry).toBe(fresh);
    expect(l2.get).toHaveBeenCalledWith("/page");
    expect(l1.put).toHaveBeenCalledWith("/page", fresh);
  });
});
