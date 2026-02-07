import { test, expect } from "@playwright/test";

function isrStatus(res: { headers: () => Record<string, string> }) {
  return res.headers()["x-isr-status"] ?? null;
}

test.describe("nested layout ISR config", () => {
  test.beforeAll(async ({ request }) => {
    // Purge everything
    await request.post("/api/revalidate", { data: { tag: "nested" } });
    await request.post("/api/revalidate", { data: { tag: "override" } });
    await request.post("/api/revalidate", { data: { path: "/nested" } });
    await request.post("/api/revalidate", { data: { path: "/nested/override" } });
    await request.post("/api/revalidate", { data: { path: "/nested/optout" } });
  });

  test.describe("layout config inheritance", () => {
    test.beforeEach(async ({ request }) => {
      await request.post("/api/revalidate", { data: { path: "/nested" } });
    });

    test("child page with no config inherits layout ISR config", async ({ request }) => {
      const first = await request.get("/nested");
      expect(first.status()).toBe(200);
      expect(isrStatus(first)).toBe("MISS");

      const second = await request.get("/nested");
      expect(isrStatus(second)).toBe("HIT");
    });

    test("inherited config uses layout tags for revalidation", async ({ request }) => {
      // Prime
      await request.get("/nested");
      expect(isrStatus(await request.get("/nested"))).toBe("HIT");

      // Purge via layout's tag
      await request.post("/api/revalidate", { data: { tag: "nested" } });

      expect(isrStatus(await request.get("/nested"))).toBe("MISS");
    });
  });

  test.describe("child override", () => {
    test.beforeEach(async ({ request }) => {
      await request.post("/api/revalidate", { data: { path: "/nested/override" } });
    });

    test("child page can override layout ISR config", async ({ request }) => {
      const first = await request.get("/nested/override");
      expect(first.status()).toBe(200);
      expect(isrStatus(first)).toBe("MISS");

      const second = await request.get("/nested/override");
      expect(isrStatus(second)).toBe("HIT");
    });

    test("override page responds to its own tag", async ({ request }) => {
      // Prime
      await request.get("/nested/override");
      expect(isrStatus(await request.get("/nested/override"))).toBe("HIT");

      // Purge via override-specific tag
      await request.post("/api/revalidate", { data: { tag: "override" } });

      expect(isrStatus(await request.get("/nested/override"))).toBe("MISS");
    });

    test("nested tag purges both inherited and override pages", async ({ request }) => {
      // Prime both
      await request.get("/nested");
      await request.get("/nested/override");
      expect(isrStatus(await request.get("/nested"))).toBe("HIT");
      expect(isrStatus(await request.get("/nested/override"))).toBe("HIT");

      // Purge via shared "nested" tag
      await request.post("/api/revalidate", { data: { tag: "nested" } });

      expect(isrStatus(await request.get("/nested"))).toBe("MISS");
      expect(isrStatus(await request.get("/nested/override"))).toBe("MISS");
    });

    test("override tag only purges override page, not inherited", async ({ request }) => {
      // Prime both
      await request.get("/nested");
      await request.get("/nested/override");
      expect(isrStatus(await request.get("/nested"))).toBe("HIT");
      expect(isrStatus(await request.get("/nested/override"))).toBe("HIT");

      // Purge only "override" tag
      await request.post("/api/revalidate", { data: { tag: "override" } });

      // Inherited page still cached, override page purged
      expect(isrStatus(await request.get("/nested"))).toBe("HIT");
      expect(isrStatus(await request.get("/nested/override"))).toBe("MISS");
    });
  });

  test.describe("child opt-out", () => {
    test("child page with revalidate: 0 is never cached (SKIP)", async ({ request }) => {
      const first = await request.get("/nested/optout");
      expect(first.status()).toBe(200);
      const firstStatus = isrStatus(first);
      expect(firstStatus).toBe("SKIP");

      const second = await request.get("/nested/optout");
      expect(isrStatus(second)).toBe("SKIP");
    });

    test("opt-out page has no-store Cache-Control", async ({ request }) => {
      const res = await request.get("/nested/optout");
      expect(res.headers()["cache-control"]).toContain("no-store");
    });

    test("opt-out does not affect sibling pages", async ({ request }) => {
      // Hit opt-out (should be SKIP)
      expect(isrStatus(await request.get("/nested/optout"))).toBe("SKIP");

      // Sibling should still cache normally
      await request.post("/api/revalidate", { data: { path: "/nested" } });
      expect(isrStatus(await request.get("/nested"))).toBe("MISS");
      expect(isrStatus(await request.get("/nested"))).toBe("HIT");
    });
  });
});
