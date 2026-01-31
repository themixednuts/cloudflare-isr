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

function makeFreshEntry(createdAt?: number): CacheEntry {
  const now = createdAt ?? Date.now();
  return {
    body: "<html>content</html>",
    headers: { "content-type": "text/html" },
    metadata: {
      createdAt: now,
      revalidateAfter: now + 60_000,
      status: 200,
      tags: [],
    },
  };
}

function makeStaleEntry(createdAt?: number): CacheEntry {
  const now = Date.now();
  const created = createdAt ?? now - 120_000;
  return {
    body: "<html>stale</html>",
    headers: { "content-type": "text/html" },
    metadata: {
      createdAt: created,
      revalidateAfter: now - 1_000,
      status: 200,
      tags: [],
    },
  };
}

describe("createTwoTierCache", () => {
  // ---------------------------------------------------------------------------
  // Basic get behavior
  // ---------------------------------------------------------------------------

  it("returns L1 HIT when L1 has it, does not check L2", async () => {
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

  it("falls through to L2 on L1 MISS, backfills L1", async () => {
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

  // ---------------------------------------------------------------------------
  // Stale entry resolution
  // ---------------------------------------------------------------------------

  it("prefers L2 HIT over L1 STALE and backfills L1", async () => {
    const stale = makeStaleEntry();
    const fresh = makeFreshEntry();
    const l1 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: stale, status: "STALE" }),
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

  it("L1 STALE + L2 STALE: picks newest entry by createdAt", async () => {
    const olderStale = makeStaleEntry(Date.now() - 200_000);
    const newerStale = makeStaleEntry(Date.now() - 50_000);
    const l1 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: olderStale, status: "STALE" }),
    });
    const l2 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: newerStale, status: "STALE" }),
    });
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("STALE");
    expect(result.entry).toBe(newerStale);
  });

  it("L1 STALE + L2 MISS: returns L1 stale entry", async () => {
    const stale = makeStaleEntry();
    const l1 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: stale, status: "STALE" }),
    });
    const l2 = makeMockLayer(); // MISS
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("STALE");
    expect(result.entry).toBe(stale);
  });

  it("L1 MISS + L2 STALE: returns L2 stale entry", async () => {
    const stale = makeStaleEntry();
    const l1 = makeMockLayer(); // MISS
    const l2 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry: stale, status: "STALE" }),
    });
    const cache = createTwoTierCache(l1, l2);

    const result = await cache.get("/page");

    expect(result.status).toBe("STALE");
    expect(result.entry).toBe(stale);
  });

  // ---------------------------------------------------------------------------
  // put / delete
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Error resilience
  // ---------------------------------------------------------------------------

  it("L1 get error: falls through to L2 gracefully", async () => {
    const entry = makeFreshEntry();
    const warn = vi.fn();
    const l1 = makeMockLayer({
      get: vi.fn().mockRejectedValue(new Error("L1 down")),
    });
    const l2 = makeMockLayer({
      get: vi.fn().mockResolvedValue({ entry, status: "HIT" }),
    });
    const cache = createTwoTierCache(l1, l2, { warn });

    const result = await cache.get("/page");

    expect(result.status).toBe("HIT");
    expect(result.entry).toBe(entry);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("L1"),
      expect.any(Error),
    );
  });

  it("L2 get error after L1 MISS: returns MISS, logs warning", async () => {
    const warn = vi.fn();
    const l1 = makeMockLayer(); // MISS
    const l2 = makeMockLayer({
      get: vi.fn().mockRejectedValue(new Error("L2 down")),
    });
    const cache = createTwoTierCache(l1, l2, { warn });

    const result = await cache.get("/page");

    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("L2"),
      expect.any(Error),
    );
  });

  it("L1 put error: does not throw, logs warning", async () => {
    const warn = vi.fn();
    const l1 = makeMockLayer({
      put: vi.fn().mockRejectedValue(new Error("L1 write fail")),
    });
    const l2 = makeMockLayer();
    const cache = createTwoTierCache(l1, l2, { warn });

    await expect(cache.put("/page", makeFreshEntry())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("L1"),
      expect.any(Error),
    );
    // L2 still wrote successfully
    expect(l2.put).toHaveBeenCalled();
  });

  it("L2 delete error: does not throw, logs warning", async () => {
    const warn = vi.fn();
    const l1 = makeMockLayer();
    const l2 = makeMockLayer({
      delete: vi.fn().mockRejectedValue(new Error("L2 delete fail")),
    });
    const cache = createTwoTierCache(l1, l2, { warn });

    await expect(cache.delete("/page")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("L2"),
      expect.any(Error),
    );
    // L1 still deleted successfully
    expect(l1.delete).toHaveBeenCalled();
  });

  it("both layers fail on put: logs both warnings, does not throw", async () => {
    const warn = vi.fn();
    const l1 = makeMockLayer({
      put: vi.fn().mockRejectedValue(new Error("L1 fail")),
    });
    const l2 = makeMockLayer({
      put: vi.fn().mockRejectedValue(new Error("L2 fail")),
    });
    const cache = createTwoTierCache(l1, l2, { warn });

    await expect(cache.put("/page", makeFreshEntry())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
