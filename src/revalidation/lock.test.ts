import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { acquireLock, releaseLock } from "./lock.ts";
import { lockKey } from "../keys.ts";

describe("acquireLock / releaseLock", () => {
  beforeEach(async () => {
    // Clean up lock keys used by tests
    await env.ISR_CACHE.delete(lockKey("/blog/post"));
  });

  it("acquireLock returns true when no lock exists", async () => {
    const result = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(result).toBe(true);
  });

  it("acquireLock returns false when lock is already held", async () => {
    await acquireLock(env.ISR_CACHE, "/blog/post");
    const second = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(second).toBe(false);
  });

  it("releaseLock removes the lock so it can be re-acquired", async () => {
    await acquireLock(env.ISR_CACHE, "/blog/post");
    await releaseLock(env.ISR_CACHE, "/blog/post");

    const result = await acquireLock(env.ISR_CACHE, "/blog/post");
    expect(result).toBe(true);
  });

  it("lock stores a value in KV under the lock key", async () => {
    await acquireLock(env.ISR_CACHE, "/blog/post");

    const stored = await env.ISR_CACHE.get(lockKey("/blog/post"));
    expect(stored).not.toBeNull();
    // The stored value is a timestamp string
    expect(Number(stored)).toBeGreaterThan(0);
  });
});
