import { describe, it, expect } from "vitest";
import { pageKey, lockKey, cacheApiUrl } from "./keys.ts";

describe("pageKey", () => {
  it("prefixes path with 'page:'", () => {
    expect(pageKey("/blog/hello")).toBe("page:/blog/hello");
  });

  it("handles root path", () => {
    expect(pageKey("/")).toBe("page:/");
  });
});

describe("lockKey", () => {
  it("prefixes path with 'lock:'", () => {
    expect(lockKey("/blog/hello")).toBe("lock:/blog/hello");
  });

  it("handles root path", () => {
    expect(lockKey("/")).toBe("lock:/");
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
