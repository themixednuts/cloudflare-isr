import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createISR } from "./isr.ts";
import { createWorkersStorage } from "./storage/workers.ts";
import { pageKey, cacheApiUrl } from "./keys.ts";
import { TagIndexDOClient } from "./revalidation/tag-index.ts";
import type { RenderFunction, RenderResult } from "./types.ts";

function makeRenderResult(overrides?: Partial<RenderResult>): RenderResult {
  return {
    body: "<html>Hello</html>",
    status: 200,
    headers: { "content-type": "text/html" },
    tags: [],
    ...overrides,
  };
}

describe("createISR / handleRequest", () => {
  let render: MockedFunction<RenderFunction>;
  let tagIndex: TagIndexDOClient;

  const CACHE_NAME = "isr-test";

  // Keys that tests may write to -- cleaned up before each test.
  const TEST_PATHS = [
    "/page",
    "/blog/hello",
    "/blog/a",
    "/blog/b",
    "/blog/post",
    "/about",
  ];
  const TEST_TAGS = ["blog", "static"];

  async function clearTag(tag: string): Promise<void> {
    await tagIndex.removeAllKeysForTag(tag);
  }

  beforeEach(async () => {
    render = vi.fn<RenderFunction>().mockResolvedValue(makeRenderResult());
    tagIndex = new TagIndexDOClient(env.TAG_INDEX, { name: "isr-tests" });

    // Clean up KV entries
    await Promise.all(
      TEST_PATHS.map((p) => env.ISR_CACHE.delete(pageKey(p))),
    );
    await Promise.all(
      TEST_TAGS.map((t) => clearTag(t)),
    );
    // Clean up lock keys
    await Promise.all(
      TEST_PATHS.map((p) => env.ISR_CACHE.delete(`lock:${p}`)),
    );

    // Clean up Cache API entries
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      TEST_PATHS.map((p) => cache.delete(cacheApiUrl(p))),
    );
  });

  function createDefaultISR(overrides?: Record<string, unknown>) {
    const storage = createWorkersStorage({
      kv: env.ISR_CACHE,
      cacheName: CACHE_NAME,
      tagIndex,
    });
    return createISR({
      storage,
      defaultRevalidate: 60,
      render,
      ...overrides,
    });
  }

  it("returns null for non-GET requests", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();
    const request = new Request("https://example.com/page", { method: "POST" });
    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("returns BYPASS response when bypass token matches", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR({ bypassToken: "secret-token" });
    const request = new Request("https://example.com/page", {
      headers: { "x-isr-bypass": "secret-token" },
    });

    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).not.toBeNull();
    expect(response!.headers.get("X-ISR-Status")).toBe("BYPASS");
    expect(render).toHaveBeenCalled();
  });

  it("skips caching when revalidate is 0", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: 0 }));
    const ctx1 = createExecutionContext();
    const isr = createDefaultISR();
    const req1 = new Request("https://example.com/page");

    const res1 = await isr.handleRequest(req1, ctx1);
    await waitOnExecutionContext(ctx1);

    expect(res1!.headers.get("X-ISR-Status")).toBe("SKIP");

    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/page");
    await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it("caches forever when revalidate is false", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: false }));
    const isr = createDefaultISR();

    const ctx1 = createExecutionContext();
    const req1 = new Request("https://example.com/page");
    const res1 = await isr.handleRequest(req1, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/page");
    const res2 = await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("returns MISS on first request (renders and caches)", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();
    const request = new Request("https://example.com/blog/hello");

    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await response!.text()).toBe("<html>Hello</html>");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("returns HIT on second request (from cache)", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();

    // First request - MISS
    const req1 = new Request("https://example.com/blog/hello");
    const res1 = await isr.handleRequest(req1, ctx);
    await waitOnExecutionContext(ctx);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // Second request - HIT
    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/blog/hello");
    const res2 = await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res2!.text()).toBe("<html>Hello</html>");

    // Render was called only once (for the MISS)
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("returns STALE and triggers background revalidation", async () => {
    // Use a very short revalidate so the entry becomes stale immediately
    render.mockResolvedValue(makeRenderResult({ revalidate: 0.001 }));
    const isr = createDefaultISR();

    // First request - MISS, entry gets revalidateAfter = now + 0*1000 = now
    const ctx1 = createExecutionContext();
    const req1 = new Request("https://example.com/page");
    const res1 = await isr.handleRequest(req1, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // Wait a tiny bit so Date.now() advances past revalidateAfter
    await new Promise((r) => setTimeout(r, 10));

    // Second request - should be STALE
    render.mockResolvedValue(makeRenderResult({ body: "<html>Updated</html>" }));
    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/page");
    const res2 = await isr.handleRequest(req2, ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("STALE");

    // Wait for background revalidation to complete
    await waitOnExecutionContext(ctx2);
  });

  it("revalidatePath deletes cache entry", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();

    // Populate cache
    const req = new Request("https://example.com/blog/hello");
    await isr.handleRequest(req, ctx);
    await waitOnExecutionContext(ctx);

    // Revalidate the path (deletes from cache)
    await isr.revalidatePath("/blog/hello");

    // Next request should be a MISS again
    render.mockResolvedValue(
      makeRenderResult({ body: "<html>New Content</html>" }),
    );
    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/blog/hello");
    const res2 = await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res2!.text()).toBe("<html>New Content</html>");
  });

  it("revalidateTag deletes all tagged paths", async () => {
    render.mockResolvedValue(makeRenderResult({ tags: ["blog"] }));
    const isr = createDefaultISR();

    // Populate cache for two blog pages
    const ctx1 = createExecutionContext();
    const req1 = new Request("https://example.com/blog/a");
    await isr.handleRequest(req1, ctx1);
    await waitOnExecutionContext(ctx1);

    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/blog/b");
    await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);

    // Revalidate by tag
    await isr.revalidateTag("blog");

    // Both should now be MISS
    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh A</html>" }));
    const ctx3 = createExecutionContext();
    const res3 = await isr.handleRequest(
      new Request("https://example.com/blog/a"),
      ctx3,
    );
    await waitOnExecutionContext(ctx3);
    expect(res3!.headers.get("X-ISR-Status")).toBe("MISS");

    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh B</html>" }));
    const ctx4 = createExecutionContext();
    const res4 = await isr.handleRequest(
      new Request("https://example.com/blog/b"),
      ctx4,
    );
    await waitOnExecutionContext(ctx4);
    expect(res4!.headers.get("X-ISR-Status")).toBe("MISS");
  });

  it("returns null when route is not configured", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR({
      routes: {
        "/about": { revalidate: 60 },
      },
    });
    const request = new Request("https://example.com/other");

    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("route matching works with wildcards", async () => {
    const isr = createDefaultISR({
      routes: {
        "/blog/*": { revalidate: 10, tags: ["blog"] },
        "/about": { revalidate: 300 },
      },
    });

    // /blog/post should match the wildcard route
    render.mockResolvedValue(
      makeRenderResult({ revalidate: undefined, tags: undefined }),
    );
    const ctx = createExecutionContext();
    const req1 = new Request("https://example.com/blog/post");
    const res1 = await isr.handleRequest(req1, ctx);
    await waitOnExecutionContext(ctx);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // Verify tags from route config were applied by checking the tag index
    const blogKeys = await tagIndex.getKeysByTag("blog");
    expect(blogKeys).toContain("/blog/post");
  });

  it("route matching works with bracket params", async () => {
    const isr = createDefaultISR({
      routes: {
        "/blog/[slug]": { revalidate: 10, tags: ["blog"] },
      },
    });

    render.mockResolvedValue(
      makeRenderResult({ revalidate: undefined, tags: undefined }),
    );
    const ctx = createExecutionContext();
    const req = new Request("https://example.com/blog/post");
    const res = await isr.handleRequest(req, ctx);
    await waitOnExecutionContext(ctx);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

    const blogKeys = await tagIndex.getKeysByTag("blog");
    expect(blogKeys).toContain("/blog/post");
  });

  it("route matching works with exact match", async () => {
    const isr = createDefaultISR({
      routes: {
        "/about": { revalidate: 300, tags: ["static"] },
      },
    });

    render.mockResolvedValue(
      makeRenderResult({ revalidate: undefined, tags: undefined }),
    );
    const ctx = createExecutionContext();
    const req = new Request("https://example.com/about");
    const res = await isr.handleRequest(req, ctx);
    await waitOnExecutionContext(ctx);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

    const staticKeys = await tagIndex.getKeysByTag("static");
    expect(staticKeys).toContain("/about");
  });

  it("returns null for ISR render header (recursion guard)", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();
    const request = new Request("https://example.com/page", {
      headers: { "X-ISR-Rendering": "1" },
    });
    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("HEAD requests are also handled", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();
    const request = new Request("https://example.com/page", { method: "HEAD" });
    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("X-ISR-Status")).toBe("MISS");
  });
});
