import { describe, it, expect } from "vitest";
import { pageKey, lockKey, cacheApiUrl, normalizeCacheKey, MAX_KEY_LENGTH } from "../src/keys.ts";

describe("pageKey", () => {
  it("prefixes path with 'page:'", () => {
    expect(pageKey("/blog/hello")).toBe("page:/blog/hello");
  });

  it("handles root path", () => {
    expect(pageKey("/")).toBe("page:/");
  });

  it("hashes path when key exceeds MAX_KEY_LENGTH", () => {
    const longPath = "/" + "a".repeat(MAX_KEY_LENGTH);
    const result = pageKey(longPath);
    expect(result.startsWith("page:hash:")).toBe(true);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });

  it("returns normal key when exactly at MAX_KEY_LENGTH", () => {
    // "page:" is 5 bytes, so path can be up to MAX_KEY_LENGTH - 5
    const path = "/" + "x".repeat(MAX_KEY_LENGTH - 5 - 1);
    const result = pageKey(path);
    expect(result).toBe(`page:${path}`);
    expect(new TextEncoder().encode(result).byteLength).toBe(MAX_KEY_LENGTH);
  });

  it("produces deterministic hashes for the same input", () => {
    const longPath = "/" + "b".repeat(MAX_KEY_LENGTH);
    expect(pageKey(longPath)).toBe(pageKey(longPath));
  });

  it("produces different hashes for different long paths", () => {
    const path1 = "/" + "c".repeat(MAX_KEY_LENGTH);
    const path2 = "/" + "d".repeat(MAX_KEY_LENGTH);
    expect(pageKey(path1)).not.toBe(pageKey(path2));
  });

  it("produces 16-character hex hash for long paths", () => {
    const longPath = "/" + "z".repeat(MAX_KEY_LENGTH);
    const result = pageKey(longPath);
    const hashPart = result.replace("page:hash:", "");
    expect(hashPart).toMatch(/^[0-9a-f]{16}$/);
  });

  it("dual hash produces distinct results for similar inputs", () => {
    // These strings are designed to be similar — a weak hash might collide
    const path1 = "/" + "a".repeat(MAX_KEY_LENGTH) + "1";
    const path2 = "/" + "a".repeat(MAX_KEY_LENGTH) + "2";
    expect(pageKey(path1)).not.toBe(pageKey(path2));
  });

  it("hashes multi-byte character paths that exceed byte limit", () => {
    // Each emoji is 4 bytes. Create a path that's short in chars but long in bytes.
    const emoji = "\u{1F600}"; // 4 bytes each
    const longPath = "/" + emoji.repeat(MAX_KEY_LENGTH / 4 + 1);
    const result = pageKey(longPath);
    expect(result.startsWith("page:hash:")).toBe(true);
  });
});

describe("lockKey", () => {
  it("prefixes path with 'lock:'", () => {
    expect(lockKey("/blog/hello")).toBe("lock:/blog/hello");
  });

  it("handles root path", () => {
    expect(lockKey("/")).toBe("lock:/");
  });

  it("hashes path when key exceeds MAX_KEY_LENGTH", () => {
    const longPath = "/" + "z".repeat(MAX_KEY_LENGTH);
    const result = lockKey(longPath);
    expect(result.startsWith("lock:hash:")).toBe(true);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  });
});

describe("cacheApiUrl", () => {
  it("returns a full URL with isr.internal host", () => {
    expect(cacheApiUrl("/blog/hello")).toBe("https://isr.internal/blog/hello");
  });

  it("handles root path", () => {
    expect(cacheApiUrl("/")).toBe("https://isr.internal/");
  });

  it("normalizes missing leading slash", () => {
    expect(cacheApiUrl("blog/hello")).toBe("https://isr.internal/blog/hello");
  });
});

describe("MAX_KEY_LENGTH", () => {
  it("is exported and is 480", () => {
    expect(MAX_KEY_LENGTH).toBe(480);
  });
});

describe("normalizeCacheKey (Web Cache Deception prevention)", () => {
  function url(path: string): URL {
    return new URL(`https://example.com${path}`);
  }

  it("returns pathname unchanged for normal paths", () => {
    expect(normalizeCacheKey(url("/blog/hello"))).toBe("/blog/hello");
  });

  it("preserves root path", () => {
    expect(normalizeCacheKey(url("/"))).toBe("/");
  });

  it("strips trailing slash", () => {
    expect(normalizeCacheKey(url("/page/"))).toBe("/page");
  });

  it("does not strip trailing slash from root", () => {
    expect(normalizeCacheKey(url("/"))).toBe("/");
  });

  it("collapses consecutive slashes", () => {
    expect(normalizeCacheKey(url("//foo///bar"))).toBe("/foo/bar");
  });

  it("normalizes /page/ and /page to the same key", () => {
    expect(normalizeCacheKey(url("/page/"))).toBe(normalizeCacheKey(url("/page")));
  });

  it("normalizes //page to /page", () => {
    expect(normalizeCacheKey(url("//page"))).toBe("/page");
  });

  it("handles deeply nested paths with trailing slash", () => {
    expect(normalizeCacheKey(url("/a/b/c/d/"))).toBe("/a/b/c/d");
  });

  it("handles paths with query strings (URL.pathname excludes query)", () => {
    const u = new URL("https://example.com/page/?q=1");
    expect(normalizeCacheKey(u)).toBe("/page");
  });
});
