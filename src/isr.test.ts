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
    "/custom-key",
    "/error-page",
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

  // ---------------------------------------------------------------------------
  // Method filtering
  // ---------------------------------------------------------------------------

  it("returns null for non-GET requests", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR();
    const request = new Request("https://example.com/page", { method: "POST" });
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

  // ---------------------------------------------------------------------------
  // BYPASS
  // ---------------------------------------------------------------------------

  it("BYPASS: renders fresh, sets no-store, does not cache", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh</html>" }));
    const isr = createDefaultISR({ bypassToken: "secret-token" });

    const ctx = createExecutionContext();
    const request = new Request("https://example.com/page", {
      headers: { "x-isr-bypass": "secret-token" },
    });
    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    expect(response).not.toBeNull();
    expect(response!.headers.get("X-ISR-Status")).toBe("BYPASS");
    expect(response!.headers.get("Cache-Control")).toBe("no-store");
    expect(await response!.text()).toBe("<html>Fresh</html>");
    // No X-ISR-Cache-Date since this is not from cache
    expect(response!.headers.get("X-ISR-Cache-Date")).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);

    // Next request without bypass should be MISS (nothing was cached)
    const ctx2 = createExecutionContext();
    const req2 = new Request("https://example.com/page");
    const res2 = await isr.handleRequest(req2, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
  });

  // ---------------------------------------------------------------------------
  // SKIP (revalidate: 0)
  // ---------------------------------------------------------------------------

  it("SKIP via render result: sets no-store, renders every time", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: 0, body: "<html>Dynamic</html>" }));
    const isr = createDefaultISR();

    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);

    expect(res1!.headers.get("X-ISR-Status")).toBe("SKIP");
    expect(res1!.headers.get("Cache-Control")).toBe("no-store");
    expect(await res1!.text()).toBe("<html>Dynamic</html>");

    // Second request also renders fresh
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("SKIP");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("SKIP via route config: revalidate 0 on route skips without render deciding", async () => {
    // Render doesn't set revalidate — the route config forces SKIP
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined }));
    const isr = createDefaultISR({
      routes: { "/page": { revalidate: 0 } },
    });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("X-ISR-Status")).toBe("SKIP");
    expect(res!.headers.get("Cache-Control")).toBe("no-store");
  });

  // ---------------------------------------------------------------------------
  // MISS
  // ---------------------------------------------------------------------------

  it("MISS: renders, caches, returns body with correct headers", async () => {
    render.mockResolvedValue(makeRenderResult({
      body: "<html>First</html>",
      headers: { "content-type": "text/html" },
    }));
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    const response = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response!.status).toBe(200);
    expect(response!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(response!.headers.get("X-ISR-Cache-Date")).not.toBeNull();
    expect(response!.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(await response!.text()).toBe("<html>First</html>");
    expect(render).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // HIT
  // ---------------------------------------------------------------------------

  it("HIT: serves cached body with cache date header, no re-render", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Cached</html>" }));
    const isr = createDefaultISR();

    // MISS
    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    const missDate = res1!.headers.get("X-ISR-Cache-Date");

    // HIT
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx2,
    );
    await waitOnExecutionContext(ctx2);

    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res2!.text()).toBe("<html>Cached</html>");
    expect(res2!.headers.get("X-ISR-Cache-Date")).toBe(missDate);
    expect(res2!.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(render).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // STALE → background revalidation
  // ---------------------------------------------------------------------------

  it("STALE: serves old content, background revalidation updates cache", async () => {
    render.mockResolvedValue(makeRenderResult({
      body: "<html>Old</html>",
      revalidate: 0.001,
    }));
    const isr = createDefaultISR();

    // First request — MISS, caches with very short TTL
    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res1!.text()).toBe("<html>Old</html>");

    // Wait for entry to become stale
    await new Promise((r) => setTimeout(r, 10));

    // Second request — STALE, serves OLD content immediately
    render.mockResolvedValue(makeRenderResult({
      body: "<html>New</html>",
      revalidate: 60,
    }));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    expect(res2!.headers.get("X-ISR-Status")).toBe("STALE");
    expect(await res2!.text()).toBe("<html>Old</html>");

    // Wait for background revalidation to complete
    await waitOnExecutionContext(ctx2);

    // Third request — HIT with NEW content from background revalidation
    const ctx3 = createExecutionContext();
    const res3 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx3,
    );
    await waitOnExecutionContext(ctx3);
    expect(res3!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res3!.text()).toBe("<html>New</html>");

    // Render called twice: once for MISS, once for background revalidation
    expect(render).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Cache forever (revalidate: false)
  // ---------------------------------------------------------------------------

  it("caches forever when revalidate is false, immutable Cache-Control", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: false }));
    const isr = createDefaultISR();

    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(res1!.headers.get("Cache-Control")).toContain("immutable");

    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // revalidatePath / revalidateTag
  // ---------------------------------------------------------------------------

  it("revalidatePath: next request is MISS with fresh content", async () => {
    const isr = createDefaultISR();

    // Populate cache
    const ctx = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/hello"), ctx);
    await waitOnExecutionContext(ctx);

    // Purge
    await isr.revalidatePath("/blog/hello");

    // Verify MISS with new content
    render.mockResolvedValue(makeRenderResult({ body: "<html>New</html>" }));
    const ctx2 = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res!.text()).toBe("<html>New</html>");
  });

  it("revalidateTag: invalidates all paths with that tag", async () => {
    render.mockResolvedValue(makeRenderResult({ tags: ["blog"] }));
    const isr = createDefaultISR();

    // Populate two pages
    const ctx1 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/a"), ctx1);
    await waitOnExecutionContext(ctx1);

    const ctx2 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/b"), ctx2);
    await waitOnExecutionContext(ctx2);

    // Verify both are cached
    const ctx3 = createExecutionContext();
    const hitA = await isr.handleRequest(new Request("https://example.com/blog/a"), ctx3);
    await waitOnExecutionContext(ctx3);
    expect(hitA!.headers.get("X-ISR-Status")).toBe("HIT");

    // Invalidate tag
    await isr.revalidateTag("blog");

    // Both should be MISS now
    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh A</html>" }));
    const ctx4 = createExecutionContext();
    const resA = await isr.handleRequest(new Request("https://example.com/blog/a"), ctx4);
    await waitOnExecutionContext(ctx4);
    expect(resA!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await resA!.text()).toBe("<html>Fresh A</html>");

    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh B</html>" }));
    const ctx5 = createExecutionContext();
    const resB = await isr.handleRequest(new Request("https://example.com/blog/b"), ctx5);
    await waitOnExecutionContext(ctx5);
    expect(resB!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await resB!.text()).toBe("<html>Fresh B</html>");
  });

  // ---------------------------------------------------------------------------
  // Route configuration
  // ---------------------------------------------------------------------------

  it("returns null when route is not in configured routes", async () => {
    const ctx = createExecutionContext();
    const isr = createDefaultISR({
      routes: { "/about": { revalidate: 60 } },
    });
    const response = await isr.handleRequest(
      new Request("https://example.com/other"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("route wildcard applies route tags when render has none", async () => {
    const isr = createDefaultISR({
      routes: { "/blog/*": { revalidate: 10, tags: ["blog"] } },
    });

    render.mockResolvedValue(makeRenderResult({ tags: undefined }));
    const ctx = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/post"), ctx);
    await waitOnExecutionContext(ctx);

    const blogKeys = await tagIndex.getKeysByTag("blog");
    expect(blogKeys).toContain("/blog/post");
  });

  it("route bracket params match correctly", async () => {
    const isr = createDefaultISR({
      routes: { "/blog/[slug]": { revalidate: 10, tags: ["blog"] } },
    });

    render.mockResolvedValue(makeRenderResult({ tags: undefined }));
    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/blog/post"), ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

    const blogKeys = await tagIndex.getKeysByTag("blog");
    expect(blogKeys).toContain("/blog/post");
  });

  it("exact route match works", async () => {
    const isr = createDefaultISR({
      routes: { "/about": { revalidate: 300, tags: ["static"] } },
    });

    render.mockResolvedValue(makeRenderResult({ tags: undefined }));
    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/about"), ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

    const staticKeys = await tagIndex.getKeysByTag("static");
    expect(staticKeys).toContain("/about");
  });

  // ---------------------------------------------------------------------------
  // Non-200 status codes
  // ---------------------------------------------------------------------------

  it("preserves non-200 status through cache", async () => {
    render.mockResolvedValue(makeRenderResult({ status: 404, body: "Not Found" }));
    const isr = createDefaultISR();

    // MISS — caches the 404
    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1!.status).toBe(404);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // HIT — serves the cached 404
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.status).toBe(404);
    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res2!.text()).toBe("Not Found");
    expect(render).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Render returning a raw Response
  // ---------------------------------------------------------------------------

  it("handles render returning a raw Response object", async () => {
    render.mockResolvedValue(
      new Response("<html>From Response</html>", {
        status: 200,
        headers: { "content-type": "text/html", "x-custom": "yes" },
      }),
    );
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res!.text()).toBe("<html>From Response</html>");
    expect(res!.headers.get("x-custom")).toBe("yes");

    // Confirm it was cached (HIT on second request)
    render.mockResolvedValue(new Response("should not be called"));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res2!.text()).toBe("<html>From Response</html>");
    expect(render).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Custom cacheKey function
  // ---------------------------------------------------------------------------

  it("uses custom cacheKey function", async () => {
    const isr = createDefaultISR({
      cacheKey: (url: URL) => url.pathname + url.search,
    });

    render.mockResolvedValue(makeRenderResult({ body: "<html>A</html>" }));
    const ctx1 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/page?v=1"), ctx1);
    await waitOnExecutionContext(ctx1);

    render.mockResolvedValue(makeRenderResult({ body: "<html>B</html>" }));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page?v=2"), ctx2,
    );
    await waitOnExecutionContext(ctx2);

    // Different query = different cache key = MISS (not HIT)
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res2!.text()).toBe("<html>B</html>");

    // Same query = HIT
    const ctx3 = createExecutionContext();
    const res3 = await isr.handleRequest(
      new Request("https://example.com/page?v=1"), ctx3,
    );
    await waitOnExecutionContext(ctx3);
    expect(res3!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res3!.text()).toBe("<html>A</html>");
  });

  // ---------------------------------------------------------------------------
  // No render function
  // ---------------------------------------------------------------------------

  it("throws when handleRequest is called without a render function", async () => {
    const storage = createWorkersStorage({
      kv: env.ISR_CACHE,
      cacheName: CACHE_NAME,
      tagIndex,
    });
    const isr = createISR({ storage, defaultRevalidate: 60 });

    const ctx = createExecutionContext();
    await expect(
      isr.handleRequest(new Request("https://example.com/page"), ctx),
    ).rejects.toThrow("No render function provided");
    await waitOnExecutionContext(ctx);
  });

  // ---------------------------------------------------------------------------
  // No routes = all paths cached
  // ---------------------------------------------------------------------------

  it("caches all paths when no routes are configured", async () => {
    const isr = createDefaultISR(); // no routes option

    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/anything/at/all"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1).not.toBeNull();
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");
  });

  // ---------------------------------------------------------------------------
  // Route revalidate overrides default
  // ---------------------------------------------------------------------------

  it("route revalidate overrides defaultRevalidate in Cache-Control", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined }));
    const isr = createDefaultISR({
      routes: { "/page": { revalidate: 300 } },
    });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

  // ---------------------------------------------------------------------------
  // Render revalidate overrides route
  // ---------------------------------------------------------------------------

  it("render result revalidate overrides route config", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: 30 }));
    const isr = createDefaultISR({
      routes: { "/page": { revalidate: 300 } },
    });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
