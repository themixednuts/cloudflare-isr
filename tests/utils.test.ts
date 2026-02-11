import { describe, it, expect, vi } from "vitest";
import {
  toRenderResult,
  sanitizeHeaders,
  normalizeTags,
  validateTag,
  resolveRevalidate,
  isNoStore,
  isForever,
  revalidateAfter,
  determineCacheStatus,
  safeCacheGet,
  applyCacheControl,
  createCacheEntryMetadata,
  createCacheEntry,
  updateTagIndexSafely,
  responseHeaders,
  host,
  resolveRequestOrigin,
  cacheEntry,
  DEFAULT_REVALIDATE,
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
} from "../src/utils.ts";
import type { RenderResult } from "../src/types.ts";

describe("toRenderResult", () => {
  it("passes through a RenderResult unchanged", async () => {
    const input: RenderResult = {
      body: "<html>hi</html>",
      status: 200,
      headers: { "content-type": "text/html" },
      tags: ["a"],
      revalidate: 60,
    };
    const result = await toRenderResult(input);
    expect(result).toBe(input);
  });

  it("converts a Response to a RenderResult", async () => {
    const response = new Response("<html>hello</html>", {
      status: 201,
      headers: { "content-type": "text/html", "x-custom": "yes" },
    });
    const result = await toRenderResult(response);
    expect(result.body).toBe("<html>hello</html>");
    expect(result.status).toBe(201);
    expect(result.headers).toMatchObject({
      "content-type": "text/html",
      "x-custom": "yes",
    });
    expect(result.revalidate).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });
});

describe("sanitizeHeaders", () => {
  it("passes through valid headers", () => {
    const result = sanitizeHeaders({ "content-type": "text/html", "x-foo": "bar" });
    expect(result).toMatchObject({ "content-type": "text/html", "x-foo": "bar" });
  });

  it("drops headers with undefined values", () => {
    const input = { "x-good": "yes", "x-bad": undefined as unknown as string };
    const result = sanitizeHeaders(input);
    expect(result["x-good"]).toBe("yes");
    expect(Object.keys(result)).not.toContain("x-bad");
  });

  it("drops invalid headers and logs a warning", () => {
    const warn = vi.fn();
    const logger = { warn };
    const result = sanitizeHeaders({ "invalid\nheader": "value" }, logger);
    expect(Object.keys(result)).not.toContain("invalid\nheader");
    expect(warn).toHaveBeenCalled();
  });
});

describe("normalizeTags", () => {
  it("returns empty array for undefined", () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("deduplicates tags", () => {
    expect(normalizeTags(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("trims whitespace", () => {
    expect(normalizeTags(["  a ", " b"])).toEqual(["a", "b"]);
  });

  it("filters empty strings", () => {
    expect(normalizeTags(["a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("accepts valid tag characters (alphanumeric, _ - . : /)", () => {
    expect(normalizeTags(["blog:post", "v1.0", "a/b/c", "my-tag", "under_score"])).toEqual([
      "blog:post", "v1.0", "a/b/c", "my-tag", "under_score",
    ]);
  });

  it("throws on tags with invalid characters", () => {
    expect(() => normalizeTags(["valid", "inv@lid"])).toThrow("invalid characters");
  });

  it("throws on tags with spaces (after trim yields inner space)", () => {
    expect(() => normalizeTags(["has space"])).toThrow("invalid characters");
  });

  it("throws when tag exceeds max length", () => {
    const longTag = "a".repeat(MAX_TAG_LENGTH + 1);
    expect(() => normalizeTags([longTag])).toThrow("maximum length");
  });

  it("accepts tag at exactly max length", () => {
    const tag = "a".repeat(MAX_TAG_LENGTH);
    expect(normalizeTags([tag])).toEqual([tag]);
  });

  it("throws when tag count exceeds max", () => {
    const tags = Array.from({ length: MAX_TAG_COUNT + 1 }, (_, i) => `tag${i}`);
    expect(() => normalizeTags(tags)).toThrow("Too many tags");
  });

  it("accepts exactly max tag count", () => {
    const tags = Array.from({ length: MAX_TAG_COUNT }, (_, i) => `tag${i}`);
    expect(normalizeTags(tags)).toHaveLength(MAX_TAG_COUNT);
  });
});

describe("validateTag", () => {
  it("accepts valid tags", () => {
    expect(() => validateTag("blog")).not.toThrow();
    expect(() => validateTag("my-tag")).not.toThrow();
    expect(() => validateTag("path/to/thing")).not.toThrow();
    expect(() => validateTag("v1.2.3")).not.toThrow();
    expect(() => validateTag("ns:tag")).not.toThrow();
  });

  it("throws on empty string", () => {
    expect(() => validateTag("")).toThrow("must not be empty");
  });

  it("throws on invalid characters", () => {
    expect(() => validateTag("tag with space")).toThrow("invalid characters");
    expect(() => validateTag("tag@bad")).toThrow("invalid characters");
    expect(() => validateTag("tag#bad")).toThrow("invalid characters");
  });

  it("throws on tag exceeding max length", () => {
    expect(() => validateTag("x".repeat(MAX_TAG_LENGTH + 1))).toThrow("maximum length");
  });
});

describe("resolveRevalidate", () => {
  it("prefers render value", () => {
    expect(resolveRevalidate({ render: 10, route: 20, defaultValue: 30 })).toBe(10);
  });

  it("falls back to route value", () => {
    expect(resolveRevalidate({ route: 20, defaultValue: 30 })).toBe(20);
  });

  it("falls back to default value", () => {
    expect(resolveRevalidate({ defaultValue: 30 })).toBe(30);
  });

  it("falls back to DEFAULT_REVALIDATE when nothing provided", () => {
    expect(resolveRevalidate({})).toBe(DEFAULT_REVALIDATE);
  });

  it("accepts false (forever) from render", () => {
    expect(resolveRevalidate({ render: false })).toBe(false);
  });

  it("accepts 0 (no-store) from render", () => {
    expect(resolveRevalidate({ render: 0 })).toBe(0);
  });
});

describe("isNoStore", () => {
  it("returns true for 0", () => {
    expect(isNoStore(0)).toBe(true);
  });

  it("returns true for negative numbers", () => {
    expect(isNoStore(-1)).toBe(true);
  });

  it("returns false for positive numbers", () => {
    expect(isNoStore(60)).toBe(false);
  });

  it("returns false for false (forever)", () => {
    expect(isNoStore(false)).toBe(false);
  });
});

describe("isForever", () => {
  it("returns true for false", () => {
    expect(isForever(false)).toBe(true);
  });

  it("returns false for numbers", () => {
    expect(isForever(0)).toBe(false);
    expect(isForever(60)).toBe(false);
  });
});

describe("revalidateAfter", () => {
  it("returns null for forever (false)", () => {
    expect(revalidateAfter(false, 1000)).toBeNull();
  });

  it("returns now + seconds * 1000 for numeric values", () => {
    const now = 1000000;
    expect(revalidateAfter(60, now)).toBe(now + 60_000);
  });
});

describe("determineCacheStatus", () => {
  it("returns HIT when revalidateAfter is null (forever)", () => {
    expect(determineCacheStatus(null, Date.now())).toBe("HIT");
  });

  it("returns HIT when now is before revalidateAfter", () => {
    const future = Date.now() + 60_000;
    expect(determineCacheStatus(future, Date.now())).toBe("HIT");
  });

  it("returns STALE when now is after revalidateAfter", () => {
    const past = Date.now() - 1;
    expect(determineCacheStatus(past, Date.now())).toBe("STALE");
  });
});

describe("safeCacheGet", () => {
  it("returns the cache result on success", async () => {
    const entry = { entry: null as null, status: "MISS" as const };
    const result = await safeCacheGet({ get: () => Promise.resolve(entry) });
    expect(result).toBe(entry);
  });

  it("returns MISS on error and logs warning", async () => {
    const warn = vi.fn();
    const result = await safeCacheGet({
      get: () => Promise.reject(new Error("broken")),
      logger: { warn },
    });
    expect(result).toEqual({ entry: null, status: "MISS" });
    expect(warn).toHaveBeenCalled();
  });

  it("uses custom label in error message", async () => {
    const warn = vi.fn();
    await safeCacheGet({
      get: () => Promise.reject(new Error("fail")),
      logger: { warn },
      label: "L1",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("L1"),
      expect.any(Error),
    );
  });
});

describe("applyCacheControl", () => {
  it("generates immutable header for forever cache", () => {
    const result = applyCacheControl({}, false);
    expect(result["Cache-Control"]).toBe(
      "public, max-age=0, s-maxage=31536000, immutable",
    );
  });

  it("generates s-maxage + stale-while-revalidate for numeric TTL", () => {
    const result = applyCacheControl({}, 120);
    expect(result["Cache-Control"]).toBe(
      "public, max-age=0, s-maxage=120, stale-while-revalidate=120",
    );
  });

  it("overrides existing Cache-Control header and logs warning", () => {
    const warn = vi.fn();
    const result = applyCacheControl({ "Cache-Control": "private" }, 60, { warn });
    expect(result["Cache-Control"]).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("overridden by ISR"),
    );
  });

  it("overrides case-insensitive Cache-Control header", () => {
    const warn = vi.fn();
    const result = applyCacheControl({ "cache-control": "no-store" }, false, { warn });
    expect(result["Cache-Control"]).toBe(
      "public, max-age=0, s-maxage=31536000, immutable",
    );
    expect(result).not.toHaveProperty("cache-control");
    expect(warn).toHaveBeenCalled();
  });

  it("does not warn when no existing Cache-Control", () => {
    const warn = vi.fn();
    applyCacheControl({}, 60, { warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("preserves other headers", () => {
    const result = applyCacheControl({ "x-custom": "yes" }, 60);
    expect(result["x-custom"]).toBe("yes");
    expect(result["Cache-Control"]).toBeDefined();
  });

  it("floors negative TTL to 0", () => {
    const result = applyCacheControl({}, -5);
    expect(result["Cache-Control"]).toContain("s-maxage=0");
  });
});

describe("createCacheEntryMetadata", () => {
  it("builds metadata with correct fields", () => {
    const now = 1000000;
    const result: RenderResult = {
      body: "hi",
      status: 200,
      tags: ["a", "b"],
    };
    const meta = createCacheEntryMetadata({
      result,
      revalidateSeconds: 60,
      now,
    });
    expect(meta.createdAt).toBe(now);
    expect(meta.revalidateAfter).toBe(now + 60_000);
    expect(meta.status).toBe(200);
    expect(meta.tags).toEqual(["a", "b"]);
  });

  it("uses routeConfig tags when result has no tags", () => {
    const meta = createCacheEntryMetadata({
      result: { body: "", status: 200 },
      routeConfig: { tags: ["route-tag"] },
      revalidateSeconds: 60,
      now: 0,
    });
    expect(meta.tags).toEqual(["route-tag"]);
  });

  it("sets revalidateAfter to null for forever", () => {
    const meta = createCacheEntryMetadata({
      result: { body: "", status: 200 },
      revalidateSeconds: false,
      now: 0,
    });
    expect(meta.revalidateAfter).toBeNull();
  });
});

describe("createCacheEntry", () => {
  it("creates a full cache entry with body, headers, and metadata", () => {
    const entry = createCacheEntry({
      result: {
        body: "<html>test</html>",
        status: 200,
        headers: { "content-type": "text/html" },
        tags: ["t"],
      },
      revalidateSeconds: 60,
      now: 1000000,
    });
    expect(entry.body).toBe("<html>test</html>");
    expect(entry.headers["content-type"]).toBe("text/html");
    expect(entry.headers["Cache-Control"]).toBeDefined();
    expect(entry.metadata.status).toBe(200);
    expect(entry.metadata.tags).toEqual(["t"]);
  });
});

describe("updateTagIndexSafely", () => {
  it("calls addKeyToTags when tags are present", async () => {
    const tagIndex = {
      addKeyToTags: vi.fn().mockResolvedValue(undefined),
      addKeyToTag: vi.fn(),
      getKeysByTag: vi.fn(),
      removeKeyFromTag: vi.fn(),
      removeAllKeysForTag: vi.fn(),
    };
    await updateTagIndexSafely({
      tagIndex,
      tags: ["a", "b"],
      key: "/page",
    });
    expect(tagIndex.addKeyToTags).toHaveBeenCalledWith(["a", "b"], "/page");
  });

  it("skips when tags are empty", async () => {
    const tagIndex = {
      addKeyToTags: vi.fn(),
      addKeyToTag: vi.fn(),
      getKeysByTag: vi.fn(),
      removeKeyFromTag: vi.fn(),
      removeAllKeysForTag: vi.fn(),
    };
    await updateTagIndexSafely({
      tagIndex,
      tags: [],
      key: "/page",
    });
    expect(tagIndex.addKeyToTags).not.toHaveBeenCalled();
  });

  it("logs warning on error instead of throwing", async () => {
    const warn = vi.fn();
    const tagIndex = {
      addKeyToTags: vi.fn().mockRejectedValue(new Error("DO error")),
      addKeyToTag: vi.fn(),
      getKeysByTag: vi.fn(),
      removeKeyFromTag: vi.fn(),
      removeAllKeysForTag: vi.fn(),
    };
    await updateTagIndexSafely({
      tagIndex,
      tags: ["a"],
      key: "/page",
      logger: { warn },
    });
    expect(warn).toHaveBeenCalled();
  });
});

describe("responseHeaders", () => {
  it("strips Set-Cookie header (case-insensitive)", () => {
    const headers = { "Set-Cookie": "session=abc", "Content-Type": "text/html" };
    const result = responseHeaders.strip(headers);
    expect(result).not.toHaveProperty("Set-Cookie");
    expect(result["Content-Type"]).toBe("text/html");
  });

  it("strips WWW-Authenticate header", () => {
    const headers = { "WWW-Authenticate": "Bearer", "X-Custom": "ok" };
    const result = responseHeaders.strip(headers);
    expect(result).not.toHaveProperty("WWW-Authenticate");
    expect(result["X-Custom"]).toBe("ok");
  });

  it("strips Proxy-Authenticate header", () => {
    const headers = { "Proxy-Authenticate": "Basic", "Content-Length": "42" };
    const result = responseHeaders.strip(headers);
    expect(result).not.toHaveProperty("Proxy-Authenticate");
    expect(result["Content-Length"]).toBe("42");
  });

  it("preserves all safe headers", () => {
    const headers = {
      "Content-Type": "text/html",
      "X-Custom": "value",
      "Cache-Control": "no-cache",
    };
    const result = responseHeaders.strip(headers);
    expect(result).toEqual(headers);
  });

  it("handles lowercase header keys", () => {
    const headers = { "set-cookie": "session=abc", "content-type": "text/html" };
    const result = responseHeaders.strip(headers);
    expect(result).not.toHaveProperty("set-cookie");
    expect(result["content-type"]).toBe("text/html");
  });
});

describe("host", () => {
  it("passes through valid hostnames", () => {
    expect(host.sanitize("example.com")).toBe("example.com");
  });

  it("passes through hostnames with port", () => {
    expect(host.sanitize("localhost:8080")).toBe("localhost:8080");
  });

  it("passes through IP addresses", () => {
    expect(host.sanitize("192.168.1.1")).toBe("192.168.1.1");
  });

  it("passes through IP addresses with port", () => {
    expect(host.sanitize("127.0.0.1:3000")).toBe("127.0.0.1:3000");
  });

  it("rejects hosts with scheme", () => {
    expect(host.sanitize("http://evil.com")).toBe("localhost");
  });

  it("rejects hosts with path", () => {
    expect(host.sanitize("evil.com/path")).toBe("localhost");
  });

  it("rejects hosts with CRLF", () => {
    expect(host.sanitize("evil.com\r\nX-Injected: true")).toBe("localhost");
  });

  it("rejects empty host", () => {
    expect(host.sanitize("")).toBe("localhost");
  });

  it("trims whitespace", () => {
    expect(host.sanitize("  example.com  ")).toBe("example.com");
  });

  it("rejects hosts with spaces", () => {
    expect(host.sanitize("evil .com")).toBe("localhost");
  });

  it("returns null for invalid host via sanitizeOrNull", () => {
    expect(host.sanitizeOrNull("http://evil.com")).toBeNull();
  });
});

describe("resolveRequestOrigin", () => {
  it("uses trustedOrigin when provided", () => {
    const origin = resolveRequestOrigin({
      rawHost: "ignored.example.com",
      trustedOrigin: "https://app.example.com",
    });
    expect(origin).toBe("https://app.example.com");
  });

  it("builds https origin from valid host by default", () => {
    const origin = resolveRequestOrigin({ rawHost: "example.com" });
    expect(origin).toBe("https://example.com");
  });

  it("supports host allowlist", () => {
    expect(
      resolveRequestOrigin({
        rawHost: "api.example.com",
        allowedHosts: ["api.example.com"],
      }),
    ).toBe("https://api.example.com");
  });

  it("rejects host outside allowlist", () => {
    expect(() =>
      resolveRequestOrigin({
        rawHost: "evil.com",
        allowedHosts: ["api.example.com"],
      })
    ).toThrow("allowedHosts");
  });

  it("rejects invalid trustedOrigin", () => {
    expect(() =>
      resolveRequestOrigin({
        rawHost: "example.com",
        trustedOrigin: "notaurl",
      })
    ).toThrow("trustedOrigin");
  });
});

describe("cacheEntry", () => {
  it("validates a well-formed cache entry", () => {
    const entry = {
      body: "<html>test</html>",
      headers: { "content-type": "text/html" },
      metadata: { createdAt: Date.now(), revalidateAfter: null, status: 200, tags: [] },
    };
    expect(cacheEntry.validate(entry)).toBe(entry);
  });

  it("rejects null", () => {
    expect(cacheEntry.validate(null)).toBeNull();
  });

  it("rejects non-object", () => {
    expect(cacheEntry.validate("string")).toBeNull();
    expect(cacheEntry.validate(42)).toBeNull();
  });

  it("rejects missing body", () => {
    expect(cacheEntry.validate({ metadata: { createdAt: 1 } })).toBeNull();
  });

  it("rejects non-string body", () => {
    expect(cacheEntry.validate({ body: 123, metadata: { createdAt: 1 } })).toBeNull();
  });

  it("rejects missing metadata", () => {
    expect(cacheEntry.validate({ body: "test" })).toBeNull();
  });

  it("rejects null metadata", () => {
    expect(cacheEntry.validate({ body: "test", metadata: null })).toBeNull();
  });

  it("rejects metadata without createdAt", () => {
    expect(cacheEntry.validate({ body: "test", metadata: { status: 200 } })).toBeNull();
  });

  it("rejects non-number createdAt", () => {
    expect(cacheEntry.validate({ body: "test", metadata: { createdAt: "now" } })).toBeNull();
  });

  it("rejects array headers", () => {
    expect(cacheEntry.validate({ body: "test", headers: [], metadata: { createdAt: 1 } })).toBeNull();
  });

  it("accepts entry without headers", () => {
    const entry = { body: "test", metadata: { createdAt: 1, revalidateAfter: null, status: 200, tags: [] } };
    expect(cacheEntry.validate(entry)).toBe(entry);
  });
});
