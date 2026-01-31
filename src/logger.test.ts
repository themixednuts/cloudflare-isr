import { describe, it, expect, vi } from "vitest";
import { logWarn, logError } from "./logger.ts";

describe("logWarn", () => {
  it("calls logger.warn when provided", () => {
    const warn = vi.fn();
    logWarn({ warn }, "something went wrong", 42);
    expect(warn).toHaveBeenCalledWith("[ISR] something went wrong", 42);
  });

  it("falls back to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn(undefined, "oops");
    expect(spy).toHaveBeenCalledWith("[ISR] oops");
    spy.mockRestore();
  });

  it("uses custom prefix", () => {
    const warn = vi.fn();
    logWarn({ warn, prefix: "[CUSTOM]" }, "msg");
    expect(warn).toHaveBeenCalledWith("[CUSTOM] msg");
  });

  it("handles non-string first argument", () => {
    const warn = vi.fn();
    logWarn({ warn }, { key: "val" });
    expect(warn).toHaveBeenCalledWith("[ISR]", { key: "val" });
  });

  it("handles no arguments", () => {
    const warn = vi.fn();
    logWarn({ warn });
    expect(warn).toHaveBeenCalledWith("[ISR]");
  });
});

describe("logError", () => {
  it("calls logger.error when provided", () => {
    const error = vi.fn();
    logError({ error }, "fatal", new Error("boom"));
    expect(error).toHaveBeenCalledWith("[ISR] fatal", expect.any(Error));
  });

  it("falls back to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError(undefined, "bad");
    expect(spy).toHaveBeenCalledWith("[ISR] bad");
    spy.mockRestore();
  });

  it("uses custom prefix", () => {
    const error = vi.fn();
    logError({ error, prefix: "[APP]" }, "crash");
    expect(error).toHaveBeenCalledWith("[APP] crash");
  });
});
