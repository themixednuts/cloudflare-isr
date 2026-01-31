import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { acquireLock } from "./lock.ts";
import { lockKey } from "../keys.ts";

describe("acquireLock", () => {
  beforeEach(async () => {
    await env.ISR_CACHE.delete(lockKey("/blog/post"));
  });

  it("returns a disposable handle when no lock exists", async () => {
    const handle = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(handle).not.toBeNull();
    // Clean up
    await handle![Symbol.asyncDispose]();
  });

  it("returns null when lock is already held", async () => {
    const first = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(first).not.toBeNull();

    const second = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(second).toBeNull();

    await first![Symbol.asyncDispose]();
  });

  it("disposing the handle releases the lock so it can be re-acquired", async () => {
    const first = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(first).not.toBeNull();

    await first![Symbol.asyncDispose]();

    const second = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(second).not.toBeNull();

    await second![Symbol.asyncDispose]();
  });

  it("lock stores a timestamp in KV under the lock key", async () => {
    const handle = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(handle).not.toBeNull();

    const stored = await env.ISR_CACHE.get(lockKey("/blog/post"));
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(0);

    await handle![Symbol.asyncDispose]();
  });

  it("disposing deletes the KV entry", async () => {
    const handle = await acquireLock(env.ISR_CACHE, "/blog/post");
    await handle![Symbol.asyncDispose]();

    const stored = await env.ISR_CACHE.get(lockKey("/blog/post"));
    expect(stored).toBeNull();
  });
});
