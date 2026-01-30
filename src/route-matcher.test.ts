import { describe, it, expect } from "vitest";
import { matchRoute } from "./route-matcher.ts";
import type { RouteConfig } from "./types.ts";

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
});
