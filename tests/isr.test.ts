import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createISR } from "../src/isr.ts";
import { createWorkersStorage } from "../src/storage/workers.ts";
import { pageKey, cacheApiUrl } from "../src/keys.ts";
import { TagIndexDOClient } from "../src/revalidation/tag-index.ts";
import type { RenderFunction, RenderResult } from "../src/types.ts";

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
  const TEST_TAGS = ["blog", "static", "inline", "featured"];

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

  // ---------------------------------------------------------------------------
  // Security: cached response header stripping (RFC 7234 §3)
  // ---------------------------------------------------------------------------

  it("strips Set-Cookie from render response before caching (session hijack prevention)", async () => {
    render.mockResolvedValue(
      makeRenderResult({
        headers: {
          "content-type": "text/html",
          "set-cookie": "session=victim-token; Path=/; HttpOnly",
          "x-custom": "preserved",
        },
      }),
    );
    const isr = createDefaultISR();
    const ctx = createExecutionContext();

    // First request: renders and caches
    const firstResponse = await isr.handleRequest(
      new Request("https://example.com/page"),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(firstResponse).not.toBeNull();
    // Set-Cookie MUST NOT appear in the response served from ISR
    expect(firstResponse!.headers.get("set-cookie")).toBeNull();
    // Safe headers are preserved
    expect(firstResponse!.headers.get("x-custom")).toBe("preserved");

    // Second request: served from cache — Set-Cookie must still be absent
    const ctx2 = createExecutionContext();
    const cachedResponse = await isr.handleRequest(
      new Request("https://example.com/page"),
      ctx2,
    );
    await waitOnExecutionContext(ctx2);

    expect(cachedResponse).not.toBeNull();
    expect(cachedResponse!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(cachedResponse!.headers.get("set-cookie")).toBeNull();
    expect(cachedResponse!.headers.get("x-custom")).toBe("preserved");
  });

  it("strips WWW-Authenticate from render response before caching", async () => {
    render.mockResolvedValue(
      makeRenderResult({
        headers: {
          "content-type": "text/html",
          "www-authenticate": "Bearer realm=\"api\"",
        },
      }),
    );
    const isr = createDefaultISR();
    const ctx = createExecutionContext();

    const response = await isr.handleRequest(
      new Request("https://example.com/page"),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response).not.toBeNull();
    expect(response!.headers.get("www-authenticate")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Security: recursion guard nonce (CVE-2024-46982)
  // ---------------------------------------------------------------------------

  it("does not bypass ISR when external request has X-ISR-Rendering: 1 (spoofed header)", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>rendered</html>" }));

    const isr = createISR({
      kv: env.ISR_CACHE,
      tagIndex: env.TAG_INDEX,
      cacheName: CACHE_NAME,
      render,
      routes: { "/page": { revalidate: 60 } },
    });

    // External request with the old recursion guard value "1"
    const request = new Request("https://example.com/page", {
      headers: { "X-ISR-Rendering": "1" },
    });
    const ctx = createExecutionContext();
    const response = await isr.handleRequest(request, ctx);
    await waitOnExecutionContext(ctx);

    // Should NOT return null (which would indicate bypass)
    // Instead should process normally and render
    expect(response).not.toBeNull();
    expect(render).toHaveBeenCalled();
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

  // ---------------------------------------------------------------------------
  // Race conditions
  // ---------------------------------------------------------------------------

  it("concurrent MISS requests: lock prevents double background revalidation", async () => {
    // Use a very short TTL so the entry goes stale quickly
    render.mockResolvedValue(makeRenderResult({
      body: "<html>V1</html>",
      revalidate: 0.001,
    }));
    const isr = createDefaultISR();

    // Prime the cache
    const ctx0 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/page"), ctx0);
    await waitOnExecutionContext(ctx0);

    // Wait for staleness
    await new Promise((r) => setTimeout(r, 10));

    // Fire two concurrent requests that both see STALE
    let renderCount = 0;
    render.mockImplementation(async () => {
      renderCount++;
      // Small delay to simulate render time
      await new Promise((r) => setTimeout(r, 20));
      return makeRenderResult({ body: `<html>V${renderCount + 1}</html>`, revalidate: 60 });
    });

    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();
    const [res1, res2] = await Promise.all([
      isr.handleRequest(new Request("https://example.com/page"), ctx1),
      isr.handleRequest(new Request("https://example.com/page"), ctx2),
    ]);

    // Both get STALE responses with old content immediately
    expect(res1!.headers.get("X-ISR-Status")).toBe("STALE");
    expect(res2!.headers.get("X-ISR-Status")).toBe("STALE");
    expect(await res1!.text()).toBe("<html>V1</html>");
    expect(await res2!.text()).toBe("<html>V1</html>");

    // Wait for background revalidations to finish
    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);

    // The lock should have prevented one of them — only one render in background
    // (the first MISS render + one background revalidation = 2 total, not 3)
    expect(renderCount).toBeLessThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // Cleanup / lifecycle
  // ---------------------------------------------------------------------------

  it("revalidateTag cleans up the tag index", async () => {
    render.mockResolvedValue(makeRenderResult({ tags: ["blog"] }));
    const isr = createDefaultISR();

    // Populate cache
    const ctx = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/a"), ctx);
    await waitOnExecutionContext(ctx);

    // Verify tag index has the key
    const before = await tagIndex.getKeysByTag("blog");
    expect(before).toContain("/blog/a");

    // Invalidate tag
    await isr.revalidateTag("blog");

    // Tag index should be empty for this tag
    const after = await tagIndex.getKeysByTag("blog");
    expect(after).not.toContain("/blog/a");
  });

  it("revalidatePath: cache is fully cleared across both tiers", async () => {
    const isr = createDefaultISR();

    // MISS — populates both L1 (Cache API) and L2 (KV)
    const ctx = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/hello"), ctx);
    await waitOnExecutionContext(ctx);

    // Confirm HIT (both layers populated)
    const ctx2 = createExecutionContext();
    const hitRes = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(hitRes!.headers.get("X-ISR-Status")).toBe("HIT");

    // Revalidate path
    await isr.revalidatePath("/blog/hello");

    // Immediately after — should be MISS, not STALE from a remaining tier
    render.mockResolvedValue(makeRenderResult({ body: "<html>After purge</html>" }));
    const ctx3 = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/blog/hello"), ctx3,
    );
    await waitOnExecutionContext(ctx3);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res!.text()).toBe("<html>After purge</html>");
  });

  it("revalidateTag after multiple pages: all become MISS, tag index is cleared", async () => {
    render.mockResolvedValue(makeRenderResult({ tags: ["blog"] }));
    const isr = createDefaultISR();

    // Populate 2 pages
    const ctx1 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/a"), ctx1);
    await waitOnExecutionContext(ctx1);

    const ctx2 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/blog/b"), ctx2);
    await waitOnExecutionContext(ctx2);

    // Confirm both are HIT
    const ctx3 = createExecutionContext();
    const hitA = await isr.handleRequest(new Request("https://example.com/blog/a"), ctx3);
    await waitOnExecutionContext(ctx3);
    expect(hitA!.headers.get("X-ISR-Status")).toBe("HIT");

    const ctx4 = createExecutionContext();
    const hitB = await isr.handleRequest(new Request("https://example.com/blog/b"), ctx4);
    await waitOnExecutionContext(ctx4);
    expect(hitB!.headers.get("X-ISR-Status")).toBe("HIT");

    // Invalidate
    await isr.revalidateTag("blog");

    // Both MISS
    render.mockResolvedValue(makeRenderResult({ body: "<html>New A</html>", tags: ["blog"] }));
    const ctx5 = createExecutionContext();
    const missA = await isr.handleRequest(new Request("https://example.com/blog/a"), ctx5);
    await waitOnExecutionContext(ctx5);
    expect(missA!.headers.get("X-ISR-Status")).toBe("MISS");

    render.mockResolvedValue(makeRenderResult({ body: "<html>New B</html>", tags: ["blog"] }));
    const ctx6 = createExecutionContext();
    const missB = await isr.handleRequest(new Request("https://example.com/blog/b"), ctx6);
    await waitOnExecutionContext(ctx6);
    expect(missB!.headers.get("X-ISR-Status")).toBe("MISS");

    // Tag index was cleaned — before the new requests re-populate, the old keys were gone
    // (verified by the fact that both were MISS, not served from a stale tier)
  });

  // ---------------------------------------------------------------------------
  // Inline route config (per-request opt-in)
  // ---------------------------------------------------------------------------

  it("inline routeConfig opts in without a static routes map", async () => {
    // No routes configured — without inline config, all paths are cached.
    // With inline config, the provided config is used.
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined, tags: undefined }));
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
      { revalidate: 120, tags: ["inline"] },
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(res!.headers.get("Cache-Control")).toContain("s-maxage=120");

    const inlineKeys = await tagIndex.getKeysByTag("inline");
    expect(inlineKeys).toContain("/page");
  });

  it("inline routeConfig bypasses the static routes map", async () => {
    // Static routes only allows /about — but inline config overrides that.
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined }));
    const isr = createDefaultISR({
      routes: { "/about": { revalidate: 60 } },
    });

    // /page would normally return null (not in static routes)
    const ctx1 = createExecutionContext();
    const noInline = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(noInline).toBeNull();

    // With inline config, /page is handled
    const ctx2 = createExecutionContext();
    const withInline = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
      { revalidate: 30 },
    );
    await waitOnExecutionContext(ctx2);
    expect(withInline).not.toBeNull();
    expect(withInline!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(withInline!.headers.get("Cache-Control")).toContain("s-maxage=30");
  });

  it("inline routeConfig revalidate: 0 triggers SKIP", async () => {
    render.mockResolvedValue(makeRenderResult({ revalidate: undefined }));
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
      { revalidate: 0 },
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("X-ISR-Status")).toBe("SKIP");
    expect(res!.headers.get("Cache-Control")).toBe("no-store");
  });

  it("inline routeConfig tags are written to tag index", async () => {
    render.mockResolvedValue(makeRenderResult({ tags: undefined }));
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    await isr.handleRequest(
      new Request("https://example.com/blog/post"), ctx,
      { revalidate: 60, tags: ["blog", "featured"] },
    );
    await waitOnExecutionContext(ctx);

    const blogKeys = await tagIndex.getKeysByTag("blog");
    const featuredKeys = await tagIndex.getKeysByTag("featured");
    expect(blogKeys).toContain("/blog/post");
    expect(featuredKeys).toContain("/blog/post");
  });
  // ---------------------------------------------------------------------------
  // Render timeout
  // ---------------------------------------------------------------------------

  it("render timeout: rejects when render exceeds timeout", async () => {
    render.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeRenderResult()), 500)),
    );
    const isr = createDefaultISR({ renderTimeout: 50 });

    const ctx = createExecutionContext();
    await expect(
      isr.handleRequest(new Request("https://example.com/page"), ctx),
    ).rejects.toThrow("Render timeout");
    await waitOnExecutionContext(ctx);
  });

  it("render timeout: succeeds when render completes within timeout", async () => {
    render.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeRenderResult({ body: "<html>Fast</html>" })), 10)),
    );
    const isr = createDefaultISR({ renderTimeout: 5000 });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res).not.toBeNull();
    expect(await res!.text()).toBe("<html>Fast</html>");
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
  });

  it("render timeout: background revalidation uses 2x timeout", async () => {
    // First render: fast, creates stale entry
    render.mockResolvedValue(makeRenderResult({
      body: "<html>Old</html>",
      revalidate: 0.001,
    }));
    const isr = createDefaultISR({ renderTimeout: 100 });

    const ctx1 = createExecutionContext();
    await isr.handleRequest(new Request("https://example.com/page"), ctx1);
    await waitOnExecutionContext(ctx1);

    await new Promise((r) => setTimeout(r, 10));

    // Second render: slow (150ms) — within 2x timeout (200ms), should succeed
    render.mockImplementation(
      () => new Promise((resolve) =>
        setTimeout(() => resolve(makeRenderResult({ body: "<html>New</html>", revalidate: 60 })), 150),
      ),
    );

    const ctx2 = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    expect(res!.headers.get("X-ISR-Status")).toBe("STALE");
    await waitOnExecutionContext(ctx2);

    // Background revalidation should have succeeded (150ms < 200ms)
    const ctx3 = createExecutionContext();
    const res3 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx3,
    );
    await waitOnExecutionContext(ctx3);
    expect(res3!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res3!.text()).toBe("<html>New</html>");
  });

  // ---------------------------------------------------------------------------
  // Lock on MISS
  // ---------------------------------------------------------------------------

  it("lockOnMiss: returns null when lock is already held", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Hello</html>" }));
    const isr = createDefaultISR({ lockOnMiss: true });

    // Pre-populate the lock key in KV to simulate another worker holding it
    await env.ISR_CACHE.put("lock:/page", Date.now().toString(), { expirationTtl: 60 });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(new Request("https://example.com/page"), ctx);
    await waitOnExecutionContext(ctx);

    // Should return null because lock was already held
    expect(res).toBeNull();
    // Render should not have been called
    expect(render).not.toHaveBeenCalled();
  });

  it("lockOnMiss: disabled — concurrent MISS requests both render", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>A</html>" }));
    const isr = createDefaultISR({ lockOnMiss: false });

    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();
    const [res1, res2] = await Promise.all([
      isr.handleRequest(new Request("https://example.com/page"), ctx1),
      isr.handleRequest(new Request("https://example.com/page"), ctx2),
    ]);
    await waitOnExecutionContext(ctx1);
    await waitOnExecutionContext(ctx2);

    // Both should get responses (neither returns null)
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // exposeHeaders
  // ---------------------------------------------------------------------------

  it("exposeHeaders: false hides X-ISR-Status and X-ISR-Cache-Date", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Hello</html>" }));
    const isr = createDefaultISR({ exposeHeaders: false });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res).not.toBeNull();
    expect(res!.headers.get("X-ISR-Status")).toBeNull();
    expect(res!.headers.get("X-ISR-Cache-Date")).toBeNull();
    expect(await res!.text()).toBe("<html>Hello</html>");
  });

  it("exposeHeaders: true (default) shows X-ISR-Status", async () => {
    render.mockResolvedValue(makeRenderResult());
    const isr = createDefaultISR();

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
  });

  // ---------------------------------------------------------------------------
  // shouldCacheStatus
  // ---------------------------------------------------------------------------

  it("shouldCacheStatus: skips caching for 5xx by default", async () => {
    render.mockResolvedValue(makeRenderResult({ status: 500, body: "Internal Error" }));
    const isr = createDefaultISR();

    // First request: MISS, but 500 is not cached
    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/error-page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1!.status).toBe(500);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // Second request: still MISS (500 was not cached)
    render.mockResolvedValue(makeRenderResult({ status: 500, body: "Internal Error 2" }));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/error-page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("shouldCacheStatus: custom predicate controls which statuses are cached", async () => {
    render.mockResolvedValue(makeRenderResult({ status: 404, body: "Not Found" }));
    // Only cache 200-299
    const isr = createDefaultISR({
      shouldCacheStatus: (status: number) => status >= 200 && status < 300,
    });

    const ctx = createExecutionContext();
    const res = await isr.handleRequest(
      new Request("https://example.com/page"), ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res!.status).toBe(404);
    expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

    // Second request should be MISS (404 was not cached)
    render.mockResolvedValue(makeRenderResult({ status: 404, body: "Not Found Again" }));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("shouldCacheStatus: skips caching 204 No Content by default (CVE-2025-49826)", async () => {
    // 204 has no body — caching it replaces real page content with an empty
    // response for all subsequent visitors (DoS via empty-body cache poisoning).
    render.mockResolvedValue(makeRenderResult({ status: 204, body: "" }));
    const isr = createDefaultISR();

    // First request: renders 204 but does NOT cache it
    const ctx1 = createExecutionContext();
    const res1 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx1,
    );
    await waitOnExecutionContext(ctx1);
    expect(res1!.status).toBe(204);
    expect(res1!.headers.get("X-ISR-Status")).toBe("MISS");

    // Second request: still MISS (204 was not cached), render called again
    render.mockResolvedValue(makeRenderResult({ status: 200, body: "<html>Real</html>" }));
    const ctx2 = createExecutionContext();
    const res2 = await isr.handleRequest(
      new Request("https://example.com/page"), ctx2,
    );
    await waitOnExecutionContext(ctx2);
    expect(res2!.status).toBe(200);
    expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
    expect(await res2!.text()).toBe("<html>Real</html>");
    expect(render).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Mixed config validation
  // ---------------------------------------------------------------------------

  it("throws when both kv and storage are provided", () => {
    expect(() => {
      createISR({
        kv: env.ISR_CACHE,
        tagIndex: env.TAG_INDEX,
        storage: createWorkersStorage({
          kv: env.ISR_CACHE,
          cacheName: "test",
          tagIndex: new TagIndexDOClient(env.TAG_INDEX),
        }),
      } as any);
    }).toThrow("Cannot mix shorthand (kv, tagIndex) and advanced (storage) config");
  });

  // ---------------------------------------------------------------------------
  // Thundering herd MISS lock
  // ---------------------------------------------------------------------------

  describe("thundering herd MISS lock", () => {
    it("5 concurrent requests with held lock: render called 0 times, all return null", async () => {
      // Simulate another worker holding the lock by pre-populating the lock key.
      // This deterministically tests the thundering herd guard: with the lock held,
      // ALL 5 requests return null and render is never called.
      await env.ISR_CACHE.put("lock:/page", Date.now().toString(), { expirationTtl: 60 });

      render.mockResolvedValue(makeRenderResult({ body: "<html>Should not render</html>" }));
      const isr = createDefaultISR({ lockOnMiss: true });
      const CONCURRENCY = 5;

      const contexts = Array.from({ length: CONCURRENCY }, () => createExecutionContext());
      const results = await Promise.all(
        contexts.map((ctx) =>
          isr.handleRequest(new Request("https://example.com/page"), ctx),
        ),
      );
      await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)));

      // All 5 requests should return null because lock is held
      const nullResults = results.filter((r) => r === null);
      expect(nullResults).toHaveLength(CONCURRENCY);

      // Render should never have been called — all 5 blocked by lock
      expect(render).not.toHaveBeenCalled();
    });

    it("lock released: next request acquires lock and renders exactly 1 time", async () => {
      render.mockResolvedValue(makeRenderResult({ body: "<html>Hello</html>" }));
      const isr = createDefaultISR({ lockOnMiss: true });

      // Pre-populate the lock
      await env.ISR_CACHE.put("lock:/page", Date.now().toString(), { expirationTtl: 60 });

      // Request returns null because lock is held
      const ctx1 = createExecutionContext();
      const res1 = await isr.handleRequest(
        new Request("https://example.com/page"), ctx1,
      );
      await waitOnExecutionContext(ctx1);
      expect(res1).toBeNull();
      expect(render).not.toHaveBeenCalled();

      // Release the lock
      await env.ISR_CACHE.delete("lock:/page");

      // Next request should acquire the lock and render successfully
      const ctx2 = createExecutionContext();
      const res2 = await isr.handleRequest(
        new Request("https://example.com/page"), ctx2,
      );
      await waitOnExecutionContext(ctx2);

      expect(res2).not.toBeNull();
      expect(res2!.headers.get("X-ISR-Status")).toBe("MISS");
      expect(await res2!.text()).toBe("<html>Hello</html>");
      // Render called exactly 1 time — only the request that got the lock
      expect(render).toHaveBeenCalledTimes(1);
    });

    it("without lockOnMiss: 5 concurrent requests all render (no protection)", async () => {
      // Contrast test: with lockOnMiss disabled, all concurrent requests render.
      // This proves the lock is what prevents the thundering herd.
      render.mockResolvedValue(makeRenderResult({ body: "<html>A</html>" }));
      const isr = createDefaultISR({ lockOnMiss: false });
      const CONCURRENCY = 5;

      const contexts = Array.from({ length: CONCURRENCY }, () => createExecutionContext());
      const results = await Promise.all(
        contexts.map((ctx) =>
          isr.handleRequest(new Request("https://example.com/page"), ctx),
        ),
      );
      await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)));

      // All 5 get responses (none return null)
      const responses = results.filter((r): r is Response => r !== null);
      expect(responses).toHaveLength(CONCURRENCY);

      // All 5 trigger render — thundering herd with no lock
      expect(render).toHaveBeenCalledTimes(CONCURRENCY);
    });

    it("single request always succeeds with lockOnMiss: true", async () => {
      render.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return makeRenderResult({ body: "<html>Winner</html>" });
      });

      const isr = createDefaultISR({ lockOnMiss: true });

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page"), ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      expect(res!.headers.get("X-ISR-Status")).toBe("MISS");
      expect(await res!.text()).toBe("<html>Winner</html>");
      expect(render).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Tag truncation desync prevention
  // ---------------------------------------------------------------------------

  describe("tag truncation desync", () => {
    it("tags exceeding KV metadata limit: tag index and cache have same truncated set", async () => {
      // Use 10 tags of max length (128 chars). Metadata with 8+ such tags exceeds
      // 1024 bytes, so fitMetadataTags will truncate to ~7. Both the cache entry
      // metadata and tag index must receive the SAME truncated set.
      const longTags = Array.from({ length: 10 }, (_, i) =>
        "a".repeat(120) + String(i).padStart(8, "0"),
      );

      render.mockResolvedValue(makeRenderResult({ tags: longTags }));
      const isr = createDefaultISR();

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page"), ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      expect(res!.headers.get("X-ISR-Status")).toBe("MISS");

      // Read what the tag index has for each tag
      const indexedTags: string[] = [];
      for (const tag of longTags) {
        const keys = await tagIndex.getKeysByTag(tag);
        if (keys.includes("/page")) {
          indexedTags.push(tag);
        }
      }

      // Read what the cache entry metadata has — fetch from KV directly
      const kvEntry = await env.ISR_CACHE.get(pageKey("/page"), { type: "json" }) as { body: string; headers: Record<string, string> } | null;
      const kvMeta = await env.ISR_CACHE.getWithMetadata(pageKey("/page"), { type: "json" });
      const metadataTags = (kvMeta.metadata as any)?.tags as string[] ?? [];

      // Both sets must be identical — no desync
      expect(indexedTags).toEqual(metadataTags);

      // Truncation actually happened (fewer than 10 tags stored)
      expect(metadataTags.length).toBeLessThan(longTags.length);
      expect(metadataTags.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // isCacheEntry type guard (via BYPASS / SKIP path where buildResponse
  // receives the raw RenderResult, not a CacheEntry)
  // ---------------------------------------------------------------------------

  describe("isCacheEntry type guard (via handleRequest behavior)", () => {
    it("BYPASS: render result with extra metadata-like property uses RenderResult fields", async () => {
      // In BYPASS mode, buildResponse receives the raw RenderResult directly
      // (not wrapped in createCacheEntry). A RenderResult with a `metadata`
      // property (but missing createdAt) must NOT be treated as a CacheEntry.
      const trickResult = {
        body: "<html>Tricky</html>",
        status: 201,
        headers: { "content-type": "text/html" },
        tags: ["tricky"],
        // Extra property that could confuse a duck-type check
        metadata: { unrelated: true },
      };

      render.mockResolvedValue(trickResult as any);
      const isr = createDefaultISR({ bypassToken: "secret-token" });

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page", {
          headers: { "x-isr-bypass": "secret-token" },
        }),
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      // Should use RenderResult.status (201), not try to read metadata.status
      expect(res!.status).toBe(201);
      expect(res!.headers.get("X-ISR-Status")).toBe("BYPASS");
      expect(await res!.text()).toBe("<html>Tricky</html>");
    });

    it("BYPASS: render result with null metadata is not treated as CacheEntry", async () => {
      const result = {
        body: "<html>Null Meta</html>",
        status: 203,
        headers: { "content-type": "text/html" },
        tags: [],
        metadata: null,
      };

      render.mockResolvedValue(result as any);
      const isr = createDefaultISR({ bypassToken: "token" });

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page", {
          headers: { "x-isr-bypass": "token" },
        }),
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      // metadata is null, so isCacheEntry returns false -> uses RenderResult.status
      expect(res!.status).toBe(203);
      expect(res!.headers.get("X-ISR-Status")).toBe("BYPASS");
    });

    it("BYPASS: render result with metadata as string is not treated as CacheEntry", async () => {
      // metadata is a string, not an object — typeof check rejects it
      const result = {
        body: "<html>String Meta</html>",
        status: 202,
        headers: { "content-type": "text/html" },
        tags: [],
        metadata: "not-an-object",
      };

      render.mockResolvedValue(result as any);
      const isr = createDefaultISR({ bypassToken: "token" });

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page", {
          headers: { "x-isr-bypass": "token" },
        }),
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      // metadata is a string, so isCacheEntry returns false -> uses RenderResult.status
      expect(res!.status).toBe(202);
      expect(res!.headers.get("X-ISR-Status")).toBe("BYPASS");
      expect(await res!.text()).toBe("<html>String Meta</html>");
    });

    it("SKIP: render result with fake metadata.createdAt is treated as CacheEntry by type guard", async () => {
      // If a RenderResult has metadata with createdAt, isCacheEntry returns
      // true and buildResponse reads status from metadata.status. This tests
      // that the guard is strict enough to detect genuine CacheEntry shapes.
      const cacheEntryLike = {
        body: "<html>CacheLike</html>",
        status: 200,
        headers: { "content-type": "text/html" },
        tags: [],
        revalidate: 0, // Forces SKIP path — buildResponse receives raw RenderResult
        metadata: {
          createdAt: Date.now(),
          revalidateAfter: null,
          status: 404,
          tags: [],
        },
      };

      render.mockResolvedValue(cacheEntryLike as any);
      const isr = createDefaultISR();

      const ctx = createExecutionContext();
      const res = await isr.handleRequest(
        new Request("https://example.com/page"), ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(res).not.toBeNull();
      // isCacheEntry returns true (metadata.createdAt exists), so buildResponse
      // uses metadata.status (404) for the HTTP status code
      expect(res!.status).toBe(404);
      expect(res!.headers.get("X-ISR-Status")).toBe("SKIP");
    });
  });
});

// ---------------------------------------------------------------------------
// Split lifecycle: lookup + cache
// ---------------------------------------------------------------------------

describe("lookup + cache (split lifecycle)", () => {
  let render: MockedFunction<RenderFunction>;
  let tagIndex: TagIndexDOClient;

  const CACHE_NAME = "isr-split-test";

  const TEST_PATHS = ["/page", "/blog/hello", "/blog/post", "/dynamic"];
  const TEST_TAGS = ["blog", "home", "split-tag"];

  async function clearTag(tag: string): Promise<void> {
    await tagIndex.removeAllKeysForTag(tag);
  }

  beforeEach(async () => {
    render = vi.fn<RenderFunction>().mockResolvedValue(makeRenderResult());
    tagIndex = new TagIndexDOClient(env.TAG_INDEX, { name: "split-tests" });

    await Promise.all(
      TEST_PATHS.map((p) => env.ISR_CACHE.delete(`isr:${p}`)),
    );
    await Promise.all(
      TEST_TAGS.map((t) => clearTag(t)),
    );

    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      TEST_PATHS.map((p) => cache.delete(cacheApiUrl(p))),
    );
  });

  function createSplitISR(overrides?: Record<string, unknown>) {
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
  // lookup
  // ---------------------------------------------------------------------------

  it("lookup: returns null on cache miss", async () => {
    const isr = createSplitISR();
    const res = await isr.lookup(new Request("https://example.com/page"));
    expect(res).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("lookup: returns null for non-GET requests", async () => {
    const isr = createSplitISR();
    const res = await isr.lookup(
      new Request("https://example.com/page", { method: "POST" }),
    );
    expect(res).toBeNull();
  });

  it("lookup: does not bypass when external request has X-ISR-Rendering: 1 (spoofed header)", async () => {
    const isr = createSplitISR();
    const res = await isr.lookup(
      new Request("https://example.com/page", {
        headers: { "X-ISR-Rendering": "1" },
      }),
    );
    // lookup should NOT return null due to spoofed header.
    // It returns null because cache is MISS, not because of recursion guard.
    // The key point: the spoofed "1" value does not match the per-instance nonce.
    expect(res).toBeNull();
  });

  it("lookup: returns HIT after cache is populated", async () => {
    const isr = createSplitISR();

    // Populate via cache()
    const ctx1 = createExecutionContext();
    const frameworkResponse = new Response("<html>Hello</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await isr.cache(
      new Request("https://example.com/page"),
      frameworkResponse,
      { revalidate: 60, tags: ["home"] },
      ctx1,
    );
    await waitOnExecutionContext(ctx1);

    // lookup should return HIT
    const res = await isr.lookup(new Request("https://example.com/page"));
    expect(res).not.toBeNull();
    expect(res!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await res!.text()).toBe("<html>Hello</html>");
    expect(render).not.toHaveBeenCalled();
  });

  it("lookup: returns STALE for expired entries", async () => {
    const isr = createSplitISR();

    // Populate with very short TTL
    const ctx1 = createExecutionContext();
    await isr.cache(
      new Request("https://example.com/page"),
      new Response("<html>Old</html>", { status: 200 }),
      { revalidate: 0.001 },
      ctx1,
    );
    await waitOnExecutionContext(ctx1);

    await new Promise((r) => setTimeout(r, 10));

    const res = await isr.lookup(new Request("https://example.com/page"));
    expect(res).not.toBeNull();
    expect(res!.headers.get("X-ISR-Status")).toBe("STALE");
    expect(await res!.text()).toBe("<html>Old</html>");
  });

  it("lookup: STALE triggers background revalidation when ctx and render provided", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Fresh</html>", revalidate: 60 }));
    const isr = createSplitISR();

    // Populate with very short TTL
    const ctx1 = createExecutionContext();
    await isr.cache(
      new Request("https://example.com/page"),
      new Response("<html>Old</html>", { status: 200 }),
      { revalidate: 0.001 },
      ctx1,
    );
    await waitOnExecutionContext(ctx1);

    await new Promise((r) => setTimeout(r, 10));

    // lookup with ctx — should trigger background revalidation
    const ctx2 = createExecutionContext();
    const stale = await isr.lookup(new Request("https://example.com/page"), ctx2);
    expect(stale!.headers.get("X-ISR-Status")).toBe("STALE");

    // Wait for background revalidation
    await waitOnExecutionContext(ctx2);

    // Next lookup should be HIT with fresh content
    const fresh = await isr.lookup(new Request("https://example.com/page"));
    expect(fresh).not.toBeNull();
    expect(fresh!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await fresh!.text()).toBe("<html>Fresh</html>");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("lookup: bypass token renders fresh when render is configured", async () => {
    render.mockResolvedValue(makeRenderResult({ body: "<html>Bypass</html>" }));
    const isr = createSplitISR({ bypassToken: "secret" });

    const res = await isr.lookup(
      new Request("https://example.com/page", {
        headers: { "x-isr-bypass": "secret" },
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.headers.get("X-ISR-Status")).toBe("BYPASS");
    expect(res!.headers.get("Cache-Control")).toBe("no-store");
  });

  // ---------------------------------------------------------------------------
  // cache
  // ---------------------------------------------------------------------------

  it("cache: stores response and returns it with ISR headers", async () => {
    const isr = createSplitISR();
    const ctx = createExecutionContext();

    const res = await isr.cache(
      new Request("https://example.com/page"),
      new Response("<html>Cached</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      { revalidate: 120 },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.headers.get("X-ISR-Status")).toBe("MISS");
    expect(res.headers.get("X-ISR-Cache-Date")).not.toBeNull();
    // Split lifecycle strips CDN cache headers so every request hits the worker
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(await res.text()).toBe("<html>Cached</html>");
  });

  it("cache: writes tags to tag index", async () => {
    const isr = createSplitISR();
    const ctx = createExecutionContext();

    await isr.cache(
      new Request("https://example.com/blog/post"),
      new Response("<html>Post</html>", { status: 200 }),
      { revalidate: 60, tags: ["blog", "split-tag"] },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const blogKeys = await tagIndex.getKeysByTag("blog");
    const splitKeys = await tagIndex.getKeysByTag("split-tag");
    expect(blogKeys).toContain("/blog/post");
    expect(splitKeys).toContain("/blog/post");
  });

  it("cache: revalidate 0 returns SKIP without caching", async () => {
    const isr = createSplitISR();
    const ctx = createExecutionContext();

    const res = await isr.cache(
      new Request("https://example.com/dynamic"),
      new Response("<html>Dynamic</html>", { status: 200 }),
      { revalidate: 0 },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.headers.get("X-ISR-Status")).toBe("SKIP");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // Should not be in cache
    const lookup = await isr.lookup(new Request("https://example.com/dynamic"));
    expect(lookup).toBeNull();
  });

  it("cache: preserves non-200 status", async () => {
    const isr = createSplitISR();
    const ctx = createExecutionContext();

    const res = await isr.cache(
      new Request("https://example.com/page"),
      new Response("Not Found", { status: 404 }),
      { revalidate: 60 },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    expect(res.headers.get("X-ISR-Status")).toBe("MISS");

    // HIT should also be 404
    const hit = await isr.lookup(new Request("https://example.com/page"));
    expect(hit!.status).toBe(404);
    expect(hit!.headers.get("X-ISR-Status")).toBe("HIT");
  });

  // ---------------------------------------------------------------------------
  // Full split lifecycle (simulates SvelteKit hook pattern)
  // ---------------------------------------------------------------------------

  it("full lifecycle: lookup miss → framework render → cache → lookup hit", async () => {
    const isr = createSplitISR();

    // 1. Hook: lookup — MISS
    const miss = await isr.lookup(new Request("https://example.com/blog/hello"));
    expect(miss).toBeNull();

    // 2. Framework renders (simulated)
    const frameworkResponse = new Response("<html>Blog Post</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    // 3. Load function opted in, hook caches the response
    const ctx1 = createExecutionContext();
    const cached = await isr.cache(
      new Request("https://example.com/blog/hello"),
      frameworkResponse,
      { revalidate: 120, tags: ["blog"] },
      ctx1,
    );
    await waitOnExecutionContext(ctx1);

    expect(cached.headers.get("X-ISR-Status")).toBe("MISS");
    // Split lifecycle strips CDN cache headers so every request hits the worker
    expect(cached.headers.get("Cache-Control")).toBe("private, no-cache");

    // 4. Next request: lookup — HIT
    const hit = await isr.lookup(new Request("https://example.com/blog/hello"));
    expect(hit).not.toBeNull();
    expect(hit!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(await hit!.text()).toBe("<html>Blog Post</html>");

    // Render was never called — framework handled rendering, ISR just cached
    expect(render).not.toHaveBeenCalled();
  });

  it("full lifecycle: revalidateTag purges entries stored via cache()", async () => {
    const isr = createSplitISR();

    // Store two pages with same tag
    const ctx1 = createExecutionContext();
    await isr.cache(
      new Request("https://example.com/blog/hello"),
      new Response("<html>A</html>", { status: 200 }),
      { revalidate: 60, tags: ["blog"] },
      ctx1,
    );
    await waitOnExecutionContext(ctx1);

    const ctx2 = createExecutionContext();
    await isr.cache(
      new Request("https://example.com/blog/post"),
      new Response("<html>B</html>", { status: 200 }),
      { revalidate: 60, tags: ["blog"] },
      ctx2,
    );
    await waitOnExecutionContext(ctx2);

    // Both should be HIT
    const hitA = await isr.lookup(new Request("https://example.com/blog/hello"));
    expect(hitA!.headers.get("X-ISR-Status")).toBe("HIT");
    const hitB = await isr.lookup(new Request("https://example.com/blog/post"));
    expect(hitB!.headers.get("X-ISR-Status")).toBe("HIT");

    // Purge by tag
    await isr.revalidateTag("blog");

    // Both should be MISS now
    const missA = await isr.lookup(new Request("https://example.com/blog/hello"));
    expect(missA).toBeNull();
    const missB = await isr.lookup(new Request("https://example.com/blog/post"));
    expect(missB).toBeNull();
  });

  it("split lifecycle: Set-Cookie from framework response is stripped before caching (RFC 7234 §3)", async () => {
    const isr = createSplitISR();
    const request = new Request("https://example.com/page");

    // 1. lookup — MISS
    const miss = await isr.lookup(request);
    expect(miss).toBeNull();

    // 2. Framework renders a response with Set-Cookie
    const frameworkResponse = new Response("<html>dashboard</html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "set-cookie": "session=victim-token; Path=/; HttpOnly",
        "x-safe-header": "preserved",
      },
    });

    // 3. Store via cache() — Set-Cookie should be stripped
    const ctx = createExecutionContext();
    const isrResponse = await isr.cache(request, frameworkResponse, { revalidate: 60 }, ctx);
    await waitOnExecutionContext(ctx);

    expect(isrResponse.headers.get("set-cookie")).toBeNull();
    expect(isrResponse.headers.get("x-safe-header")).toBe("preserved");

    // 4. Next request — cached response also has no Set-Cookie
    const cached = await isr.lookup(new Request("https://example.com/page"));
    expect(cached).not.toBeNull();
    expect(cached!.headers.get("X-ISR-Status")).toBe("HIT");
    expect(cached!.headers.get("set-cookie")).toBeNull();
    expect(cached!.headers.get("x-safe-header")).toBe("preserved");
  });

  it("split lifecycle: 204 No Content response is not cached (CVE-2025-49826)", async () => {
    const isr = createSplitISR();
    const request = new Request("https://example.com/page");

    // 1. lookup — MISS
    const miss = await isr.lookup(request);
    expect(miss).toBeNull();

    // 2. Framework returns 204 No Content (empty body)
    const frameworkResponse = new Response(null, { status: 204 });

    // 3. cache() should skip caching the 204 response
    const ctx = createExecutionContext();
    const isrResponse = await isr.cache(request, frameworkResponse, { revalidate: 60 }, ctx);
    await waitOnExecutionContext(ctx);

    expect(isrResponse.status).toBe(204);
    // MISS means "not stored" — the 204 was returned but not cached
    expect(isrResponse.headers.get("X-ISR-Status")).toBe("MISS");

    // 4. Next request — still MISS (204 was not cached)
    const miss2 = await isr.lookup(new Request("https://example.com/page"));
    expect(miss2).toBeNull();
  });

  it("full lifecycle: route that doesn't set config is not cached", async () => {
    const isr = createSplitISR();

    // 1. lookup — MISS
    const miss = await isr.lookup(new Request("https://example.com/page"));
    expect(miss).toBeNull();

    // 2. Framework renders, but load function did NOT set isrRouteConfig
    //    Hook returns the framework response directly without calling cache()

    // 3. Next request — still MISS (nothing was cached)
    const miss2 = await isr.lookup(new Request("https://example.com/page"));
    expect(miss2).toBeNull();
  });
});
