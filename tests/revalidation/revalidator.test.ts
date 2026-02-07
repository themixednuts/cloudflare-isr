import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import { env } from "cloudflare:test";
import { revalidate } from "../../src/revalidation/revalidator.ts";
import { lockKey } from "../../src/keys.ts";
import { createKvLock } from "../../src/revalidation/lock.ts";
import { TagIndexDOClient } from "../../src/revalidation/tag-index.ts";
import type { CacheLayer, LockProvider, RenderFunction, RenderResult } from "../../src/types.ts";

function makeMockCache(): CacheLayer {
  return {
    get: vi.fn().mockResolvedValue({ entry: null, status: "MISS" }),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRenderResult(overrides?: Partial<RenderResult>): RenderResult {
  return {
    body: "<html>rendered</html>",
    status: 200,
    headers: { "content-type": "text/html" },
    tags: ["blog"],
    ...overrides,
  };
}

describe("revalidate", () => {
  let cache: CacheLayer;
  let render: MockedFunction<RenderFunction>;
  let tagIndex: TagIndexDOClient;
  let lock: LockProvider;

  async function clearTag(tag: string): Promise<void> {
    await tagIndex.removeAllKeysForTag(tag);
  }

  beforeEach(async () => {
    cache = makeMockCache();
    render = vi.fn<RenderFunction>().mockResolvedValue(makeRenderResult());
    tagIndex = new TagIndexDOClient(env.TAG_INDEX, { name: "revalidator-tests" });
    lock = createKvLock(env.ISR_CACHE);

    // Clean up KV keys used by tests
    await env.ISR_CACHE.delete(lockKey("/blog/post"));
    await env.ISR_CACHE.delete(lockKey("/page"));
    await clearTag("blog");
  });

  it("acquires lock, renders, stores in cache, updates tag index, releases lock", async () => {
    const request = new Request("https://example.com/blog/post");

    await revalidate({
      key: "/blog/post",
      request,
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
    });

    // Render was called
    expect(render).toHaveBeenCalledWith(request);

    // Cache was written to
    expect(cache.put).toHaveBeenCalledWith(
      "/blog/post",
      expect.objectContaining({
        body: "<html>rendered</html>",
        headers: expect.objectContaining({ "content-type": "text/html" }),
        metadata: expect.objectContaining({
          status: 200,
          tags: ["blog"],
        }),
      }),
    );

    // Tag index was updated
    const tagKeys = await tagIndex.getKeysByTag("blog");
    expect(tagKeys).toContain("/blog/post");

    // Lock was released (disposed)
    const lockValue = await env.ISR_CACHE.get(lockKey("/blog/post"));
    expect(lockValue).toBeNull();
  });

  it("returns early if lock is already held (does not render)", async () => {
    // Pre-acquire the lock
    await env.ISR_CACHE.put(lockKey("/blog/post"), Date.now().toString(), {
      expirationTtl: 60,
    });

    await revalidate({
      key: "/blog/post",
      request: new Request("https://example.com/blog/post"),
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
    });

    expect(render).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("on render error: logs error, does not delete cache, releases lock", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render.mockRejectedValue(new Error("render failed"));

    await revalidate({
      key: "/blog/post",
      request: new Request("https://example.com/blog/post"),
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
    });

    // Error was logged
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Background revalidation failed"),
      expect.any(Error),
    );

    // Cache was NOT deleted (preserves last-known-good)
    expect(cache.delete).not.toHaveBeenCalled();

    // Lock was released (disposed)
    const lockValue = await env.ISR_CACHE.get(lockKey("/blog/post"));
    expect(lockValue).toBeNull();

    errorSpy.mockRestore();
  });

  it("uses result.revalidate if provided", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: 120 }));

    await revalidate({
      key: "/page",
      request: new Request("https://example.com/page"),
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
      routeConfig: { revalidate: 300 },
    });

    const putCall = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const metadata = (putCall[1] as any).metadata;
    // revalidateAfter should use 120s (from result), not 300 (routeConfig) or 60 (default)
    const expectedDelta = 120 * 1000;
    const actualDelta = metadata.revalidateAfter - metadata.createdAt;
    expect(actualDelta).toBe(expectedDelta);
  });

  it("falls back to routeConfig.revalidate when result.revalidate is undefined", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined }));

    await revalidate({
      key: "/page",
      request: new Request("https://example.com/page"),
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
      routeConfig: { revalidate: 300 },
    });

    const putCall = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const metadata = (putCall[1] as any).metadata;
    const actualDelta = metadata.revalidateAfter - metadata.createdAt;
    expect(actualDelta).toBe(300 * 1000);
  });

  it("falls back to defaultRevalidate when both are undefined", async () => {
    render.mockResolvedValue(
      makeRenderResult({ revalidate: undefined, tags: [] }),
    );

    await revalidate({
      key: "/page",
      request: new Request("https://example.com/page"),
      lock,
      tagIndex,
      cache,
      render,
      defaultRevalidate: 60,
    });

    const putCall = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const metadata = (putCall[1] as any).metadata;
    const actualDelta = metadata.revalidateAfter - metadata.createdAt;
    expect(actualDelta).toBe(60 * 1000);
  });
});
