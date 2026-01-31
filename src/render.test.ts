import { describe, it, expect, vi } from "vitest";
import { renderer, ISR_RENDER_HEADER } from "./render.ts";

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
