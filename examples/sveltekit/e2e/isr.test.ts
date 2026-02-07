import { test, expect } from "@playwright/test";

function isrStatus(res: { headers: () => Record<string, string> }) {
  return res.headers()["x-isr-status"] ?? null;
}

async function revalidate(
  request: typeof test extends (
    ...a: any
  ) => any
    ? never
    : any,
  body: { path?: string; tag?: string },
) {
  return request.post("/api/revalidate", { data: body });
}

test.describe("ISR split lifecycle", () => {
  test.beforeAll(async ({ request }) => {
    // Purge all caches for a clean slate
    await request.post("/api/revalidate", { data: { path: "/" } });
    await request.post("/api/revalidate", { data: { path: "/blog/hello-world" } });
    await request.post("/api/revalidate", { data: { path: "/blog/getting-started" } });
    await request.post("/api/revalidate", { data: { tag: "home" } });
    await request.post("/api/revalidate", { data: { tag: "blog" } });
  });

  test.describe("cache lifecycle", () => {
    test.beforeEach(async ({ request }) => {
      await request.post("/api/revalidate", { data: { tag: "home" } });
    });

    test("first request returns MISS", async ({ request }) => {
      const res = await request.get("/");
      expect(res.status()).toBe(200);
      expect(isrStatus(res)).toBe("MISS");
    });

    test("second request returns HIT with identical body", async ({ request }) => {
      const first = await request.get("/");
      expect(isrStatus(first)).toBe("MISS");
      const firstBody = await first.text();

      const second = await request.get("/");
      expect(isrStatus(second)).toBe("HIT");
      expect(await second.text()).toBe(firstBody);
    });

    test("HIT response preserves cache date from original render", async ({ request }) => {
      const first = await request.get("/");
      const cacheDate = first.headers()["x-isr-cache-date"];
      expect(cacheDate).toBeTruthy();

      const second = await request.get("/");
      expect(second.headers()["x-isr-cache-date"]).toBe(cacheDate);
    });

    test("does not set s-maxage on split lifecycle responses", async ({ request }) => {
      const res = await request.get("/");
      const cc = res.headers()["cache-control"] ?? "";
      expect(cc).not.toContain("s-maxage");
    });
  });

  test.describe("blog routes", () => {
    test.beforeEach(async ({ request }) => {
      await request.post("/api/revalidate", { data: { tag: "blog" } });
    });

    test("blog page MISS then HIT", async ({ request }) => {
      const first = await request.get("/blog/hello-world");
      expect(first.status()).toBe(200);
      expect(isrStatus(first)).toBe("MISS");
      expect(await first.text()).toContain("Hello World");

      const second = await request.get("/blog/hello-world");
      expect(isrStatus(second)).toBe("HIT");
    });

    test("different blog posts cached independently", async ({ request }) => {
      const a = await request.get("/blog/hello-world");
      expect(isrStatus(a)).toBe("MISS");

      const b = await request.get("/blog/getting-started");
      expect(isrStatus(b)).toBe("MISS");

      const a2 = await request.get("/blog/hello-world");
      expect(isrStatus(a2)).toBe("HIT");

      const b2 = await request.get("/blog/getting-started");
      expect(isrStatus(b2)).toBe("HIT");
    });
  });

  test.describe("path revalidation", () => {
    test("purges specific path, next request is MISS", async ({ request }) => {
      // Prime
      await request.get("/");
      const cached = await request.get("/");
      expect(isrStatus(cached)).toBe("HIT");

      // Purge
      const res = await request.post("/api/revalidate", { data: { path: "/" } });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ revalidated: true });

      // Verify purged
      const after = await request.get("/");
      expect(isrStatus(after)).toBe("MISS");
    });
  });

  test.describe("tag revalidation", () => {
    test("purges all blog posts when blog tag is revalidated", async ({ request }) => {
      // Prime both
      await request.get("/blog/hello-world");
      await request.get("/blog/getting-started");

      const cachedA = await request.get("/blog/hello-world");
      const cachedB = await request.get("/blog/getting-started");
      expect(isrStatus(cachedA)).toBe("HIT");
      expect(isrStatus(cachedB)).toBe("HIT");

      // Purge blog tag
      const res = await request.post("/api/revalidate", { data: { tag: "blog" } });
      expect(await res.json()).toEqual({ revalidated: true });

      // Both MISS
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("MISS");
      expect(isrStatus(await request.get("/blog/getting-started"))).toBe("MISS");
    });

    test("blog tag purge does not affect home page", async ({ request }) => {
      // Prime both
      await request.get("/");
      await request.get("/blog/hello-world");
      expect(isrStatus(await request.get("/"))).toBe("HIT");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("HIT");

      // Purge only blog
      await request.post("/api/revalidate", { data: { tag: "blog" } });

      expect(isrStatus(await request.get("/"))).toBe("HIT");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("MISS");
    });

    test("home tag purge does not affect blog pages", async ({ request }) => {
      // Prime both
      await request.get("/");
      await request.get("/blog/hello-world");
      expect(isrStatus(await request.get("/"))).toBe("HIT");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("HIT");

      // Purge only home
      await request.post("/api/revalidate", { data: { tag: "home" } });

      expect(isrStatus(await request.get("/"))).toBe("MISS");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("HIT");
    });
  });

  test.describe("non-ISR routes", () => {
    test("routes without isrRouteConfig have no ISR headers", async ({ request }) => {
      const res = await request.get("/api/revalidate");
      // GET to the revalidate endpoint returns 405
      expect(res.status()).toBe(405);
      expect(res.headers()["x-isr-status"]).toBeUndefined();
    });
  });

  test.describe("revalidation API", () => {
    test("empty payload succeeds as no-op", async ({ request }) => {
      const res = await request.post("/api/revalidate", { data: {} });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ revalidated: true });
    });

    test("combined path + tag purges both", async ({ request }) => {
      // Prime
      await request.get("/");
      await request.get("/blog/hello-world");
      expect(isrStatus(await request.get("/"))).toBe("HIT");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("HIT");

      // Purge both
      await request.post("/api/revalidate", { data: { path: "/", tag: "blog" } });

      expect(isrStatus(await request.get("/"))).toBe("MISS");
      expect(isrStatus(await request.get("/blog/hello-world"))).toBe("MISS");
    });
  });

  test.describe("timestamp behavior", () => {
    test("cached responses preserve the original timestamp", async ({ request }) => {
      await request.post("/api/revalidate", { data: { path: "/" } });

      const first = await request.get("/");
      expect(isrStatus(first)).toBe("MISS");
      const firstBody = await first.text();

      // Wait to ensure a re-render would produce a different timestamp
      await new Promise((r) => setTimeout(r, 100));

      const second = await request.get("/");
      expect(isrStatus(second)).toBe("HIT");
      expect(await second.text()).toBe(firstBody);

      // After revalidation, body should differ
      await request.post("/api/revalidate", { data: { path: "/" } });
      await new Promise((r) => setTimeout(r, 100));

      const third = await request.get("/");
      expect(isrStatus(third)).toBe("MISS");
      const thirdBody = await third.text();
      expect(thirdBody).not.toBe(firstBody);
    });
  });
});
