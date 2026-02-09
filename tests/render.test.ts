import { describe, it, expect, vi } from "vitest";
import { renderer, ISR_RENDER_HEADER, requestHeaders } from "../src/render.ts";

describe("renderer", () => {
  it("creates a function that fetches the same URL with the recursion guard header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>page</html>", { status: 200 }),
    );

    const render = renderer();
    const request = new Request("https://example.com/page", {
      headers: { "accept": "text/html" },
    });
    const response = await render(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.url).toBe("https://example.com/page");
    expect(fetchedRequest.headers.get(ISR_RENDER_HEADER)).toBe("1");
    // Original headers are preserved
    expect(fetchedRequest.headers.get("accept")).toBe("text/html");

    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).text()).toBe("<html>page</html>");

    fetchSpy.mockRestore();
  });

  it("merges custom headers from init", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );

    const render = renderer({ headers: { "x-custom": "value" } });
    await render(new Request("https://example.com/test"));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("x-custom")).toBe("value");
    expect(fetchedRequest.headers.get(ISR_RENDER_HEADER)).toBe("1");

    fetchSpy.mockRestore();
  });
});

describe("ISR_RENDER_HEADER", () => {
  it("is X-ISR-Rendering", () => {
    expect(ISR_RENDER_HEADER).toBe("X-ISR-Rendering");
  });
});

describe("requestHeaders", () => {
  it("strips Cookie header from self-fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer();
    await render(new Request("https://example.com/page", {
      headers: { "cookie": "session=abc123", "accept": "text/html" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("cookie")).toBeNull();
    expect(fetchedRequest.headers.get("accept")).toBe("text/html");

    fetchSpy.mockRestore();
  });

  it("strips Authorization header from self-fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer();
    await render(new Request("https://example.com/page", {
      headers: { "authorization": "Bearer token123" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("authorization")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("strips Proxy-Authorization header from self-fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer();
    await render(new Request("https://example.com/page", {
      headers: { "proxy-authorization": "Basic creds" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("proxy-authorization")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("strips X-ISR-Bypass header from self-fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer();
    await render(new Request("https://example.com/page", {
      headers: { "x-isr-bypass": "secret" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("x-isr-bypass")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("preserves Cookie when in headerAllowlist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer({ headerAllowlist: ["cookie"] });
    await render(new Request("https://example.com/page", {
      headers: { "cookie": "session=abc123", "authorization": "Bearer token" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("cookie")).toBe("session=abc123");
    expect(fetchedRequest.headers.get("authorization")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("preserves non-sensitive headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer();
    await render(new Request("https://example.com/page", {
      headers: {
        "accept": "text/html",
        "accept-language": "en-US",
        "x-custom": "value",
        "cookie": "session=abc",
      },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("accept")).toBe("text/html");
    expect(fetchedRequest.headers.get("accept-language")).toBe("en-US");
    expect(fetchedRequest.headers.get("x-custom")).toBe("value");
    expect(fetchedRequest.headers.get("cookie")).toBeNull();

    fetchSpy.mockRestore();
  });

  it("strip method works directly on Headers", () => {
    const headers = new Headers({
      "cookie": "a=b",
      "authorization": "Bearer x",
      "content-type": "text/html",
    });
    requestHeaders.strip(headers);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("text/html");
  });

  it("allowlist is case-insensitive", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const render = renderer({ headerAllowlist: ["Cookie"] });
    await render(new Request("https://example.com/page", {
      headers: { "cookie": "session=abc" },
    }));

    const fetchedRequest = fetchSpy.mock.calls[0]![0] as Request;
    expect(fetchedRequest.headers.get("cookie")).toBe("session=abc");

    fetchSpy.mockRestore();
  });
});
