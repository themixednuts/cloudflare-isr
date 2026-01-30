import { describe, it, expect } from "vitest";
import { isBypass } from "./bypass.ts";

describe("isBypass", () => {
  it("returns false when no bypassToken is configured", () => {
    const request = new Request("https://example.com/", {
      headers: { "x-isr-bypass": "some-token" },
    });
    expect(isBypass(request)).toBe(false);
    expect(isBypass(request, undefined)).toBe(false);
  });

  it("returns false when token does not match", () => {
    const request = new Request("https://example.com/", {
      headers: { "x-isr-bypass": "wrong-token" },
    });
    expect(isBypass(request, "correct-token")).toBe(false);
  });

  it("returns true when x-isr-bypass header matches", () => {
    const request = new Request("https://example.com/", {
      headers: { "x-isr-bypass": "my-secret" },
    });
    expect(isBypass(request, "my-secret")).toBe(true);
  });

  it("trims whitespace in x-isr-bypass header", () => {
    const request = new Request("https://example.com/", {
      headers: { "x-isr-bypass": "  my-secret  " },
    });
    expect(isBypass(request, "my-secret")).toBe(true);
  });

  it("returns true when __isr_bypass cookie matches", () => {
    const request = new Request("https://example.com/", {
      headers: { cookie: "session=abc; __isr_bypass=my-secret; other=val" },
    });
    expect(isBypass(request, "my-secret")).toBe(true);
  });

  it("handles cookie separators without spaces", () => {
    const request = new Request("https://example.com/", {
      headers: { cookie: "session=abc;__isr_bypass=my-secret;other=val" },
    });
    expect(isBypass(request, "my-secret")).toBe(true);
  });

  it("accepts URL-encoded bypass cookie values", () => {
    const request = new Request("https://example.com/", {
      headers: { cookie: "__isr_bypass=my%2Fsecret%3Dtoken" },
    });
    expect(isBypass(request, "my/secret=token")).toBe(true);
  });

  it("returns false when cookie has wrong value", () => {
    const request = new Request("https://example.com/", {
      headers: { cookie: "__isr_bypass=wrong-value" },
    });
    expect(isBypass(request, "my-secret")).toBe(false);
  });

  it("returns false when no header or cookie is present", () => {
    const request = new Request("https://example.com/");
    expect(isBypass(request, "my-secret")).toBe(false);
  });
});
