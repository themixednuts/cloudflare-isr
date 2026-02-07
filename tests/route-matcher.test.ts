import { describe, it, expect } from "vitest";
import { matchRoute } from "../src/route-matcher.ts";
import type { RouteConfig } from "../src/types.ts";

function cfg(revalidate = 60): RouteConfig {
  return { revalidate };
}

describe("matchRoute", () => {
  it("matches an exact path", () => {
    const result = matchRoute("/about", { "/about": cfg() });
    expect(result).toEqual({ pattern: "/about", config: cfg() });
  });

  it("matches a single [param] segment", () => {
    const result = matchRoute("/blog/hello", { "/blog/[slug]": cfg() });
    expect(result).toEqual({ pattern: "/blog/[slug]", config: cfg() });
  });

  it("matches a :param segment", () => {
    const result = matchRoute("/blog/hello", { "/blog/:slug": cfg() });
    expect(result).toEqual({ pattern: "/blog/:slug", config: cfg() });
  });

  it("does NOT match extra segments beyond a [param]", () => {
    const result = matchRoute("/blog/hello/world", { "/blog/[slug]": cfg() });
    expect(result).toBeNull();
  });

  it("matches a catch-all [...rest] across multiple segments", () => {
    const result = matchRoute("/docs/a/b/c", { "/docs/[...rest]": cfg() });
    expect(result).toEqual({ pattern: "/docs/[...rest]", config: cfg() });
  });

  it("matches a mixed pattern with param and literal segments", () => {
    const result = matchRoute("/blog/hello/comments", {
      "/blog/[slug]/comments": cfg(),
    });
    expect(result).toEqual({
      pattern: "/blog/[slug]/comments",
      config: cfg(),
    });
  });

  it("matches a trailing wildcard *", () => {
    const result = matchRoute("/products/anything", {
      "/products/*": cfg(),
    });
    expect(result).toEqual({ pattern: "/products/*", config: cfg() });
  });

  it("returns null when no route matches", () => {
    const result = matchRoute("/unknown", {
      "/about": cfg(),
      "/blog/[slug]": cfg(),
    });
    expect(result).toBeNull();
  });

  it("returns the first matching route when multiple patterns could match", () => {
    const routes: Record<string, RouteConfig> = {
      "/blog/featured": cfg(30),
      "/blog/[slug]": cfg(120),
    };
    const result = matchRoute("/blog/featured", routes);
    expect(result).toEqual({ pattern: "/blog/featured", config: cfg(30) });
  });

  it("throws on multiple catch-all segments", () => {
    expect(() =>
      matchRoute("/a/b", { "/[...a]/[...b]": cfg() }),
    ).toThrow("must not contain multiple catch-all segments");
  });

  it("throws when pattern exceeds maximum length", () => {
    const longPattern = "/" + "a".repeat(600);
    expect(() =>
      matchRoute("/test", { [longPattern]: cfg() }),
    ).toThrow("exceeds maximum length");
  });

  it("allows a single catch-all segment", () => {
    const result = matchRoute("/docs/a/b", { "/docs/[...rest]": cfg() });
    expect(result).toEqual({ pattern: "/docs/[...rest]", config: cfg() });
  });

  // ---------------------------------------------------------------------------
  // ReDoS prevention
  // ---------------------------------------------------------------------------

  describe("ReDoS prevention", () => {
    it("rejects patterns with multiple catch-all segments", () => {
      expect(() =>
        matchRoute("/a/b/c/d", { "/[...a]/[...b]": cfg() }),
      ).toThrow("must not contain multiple catch-all segments");
    });

    it("rejects patterns with catch-all + wildcard combo", () => {
      // [...a] and * both produce greedy quantifiers — combined they can
      // cause catastrophic backtracking. The validator catches multiple catch-alls.
      expect(() =>
        matchRoute("/a/b", { "/[...a]/[...b]/*": cfg() }),
      ).toThrow("must not contain multiple catch-all segments");
    });

    it("rejects pattern exceeding maximum length", () => {
      const longPattern = "/" + "a".repeat(600);
      expect(() =>
        matchRoute("/test", { [longPattern]: cfg() }),
      ).toThrow("exceeds maximum length");
    });

    it("pattern at exactly MAX_PATTERN_LENGTH (512) is accepted", () => {
      // 511 chars + leading "/" = 512 total
      const maxPattern = "/" + "a".repeat(511);
      const result = matchRoute(maxPattern, { [maxPattern]: cfg() });
      expect(result).toEqual({ pattern: maxPattern, config: cfg() });
    });

    it("1000+ char path matching completes fast against a catch-all pattern", () => {
      // A path over 1000 chars should match in bounded time against a catch-all.
      // If the regex had catastrophic backtracking, this would hang.
      const longPath = "/" + Array.from({ length: 200 }, (_, i) => `seg${i}`).join("/");
      expect(longPath.length).toBeGreaterThan(1000);

      const start = Date.now();
      const result = matchRoute(longPath, { "/[...rest]": cfg() });
      const elapsed = Date.now() - start;

      expect(result).toEqual({ pattern: "/[...rest]", config: cfg() });
      // Should complete in well under 100ms (typically < 1ms)
      expect(elapsed).toBeLessThan(100);
    });

    it("long path matching completes fast against multiple param patterns", () => {
      // Multiple [param] segments should not cause exponential backtracking
      const routes: Record<string, ReturnType<typeof cfg>> = {
        "/a/[p1]/[p2]/[p3]/[p4]/[p5]": cfg(),
      };
      const longPath = "/a/b/c/d/e/f";

      const start = Date.now();
      const result = matchRoute(longPath, routes);
      const elapsed = Date.now() - start;

      expect(result).toEqual({ pattern: "/a/[p1]/[p2]/[p3]/[p4]/[p5]", config: cfg() });
      expect(elapsed).toBeLessThan(50);
    });

    it("non-matching long path against many patterns completes fast", () => {
      // Many patterns, none matching — regex compilation + testing should not hang
      const routes: Record<string, ReturnType<typeof cfg>> = {};
      for (let i = 0; i < 50; i++) {
        routes[`/route-${i}/[slug]`] = cfg();
      }
      const longPath = "/no-match/" + "x".repeat(200);

      const start = Date.now();
      const result = matchRoute(longPath, routes);
      const elapsed = Date.now() - start;

      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(100);
    });
  });
});
