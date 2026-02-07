import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { acquireLock } from "../../src/revalidation/lock.ts";
import { lockKey } from "../../src/keys.ts";
import type { Logger } from "../../src/types.ts";

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

  it("dispose does not throw when kv.delete fails, logs warning instead", async () => {
    // Create a wrapper that delegates to real KV but throws on delete
    const realKv = env.ISR_CACHE;
    const deleteSpy = vi.fn(() => Promise.reject(new Error("KV delete failed")));
    const failingKv = new Proxy(realKv, {
      get(target, prop) {
        if (prop === "delete") {
          return deleteSpy;
        }
        const value = target[prop as keyof typeof target];
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    }) as typeof realKv;
    const logger: Logger = { warn: vi.fn() };

    const handle = await acquireLock(failingKv, "/blog/post", logger);
    expect(handle).not.toBeNull();

    // Should not throw — dispose swallows the error
    await handle![Symbol.asyncDispose]();

    // (a) kv.delete was called (attempted cleanup)
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(deleteSpy).toHaveBeenCalledWith(lockKey("/blog/post"));

    // (b) No exception propagated (verified by reaching this line)

    // (c) Warning was logged with the lock key name
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to release lock"),
      expect.any(Error),
    );
    // Verify the log message includes the actual lock key for debugging
    const logMessage = (logger.warn as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(logMessage).toContain(lockKey("/blog/post"));
  });

  it("lock can be re-acquired after failed release once TTL expires", async () => {
    // After a failed dispose, the KV entry still exists (delete threw).
    // The lock is only re-acquirable once the KV entry is manually cleaned
    // or its TTL expires. This test verifies that:
    // 1. Failed release leaves the lock held (kv entry persists)
    // 2. Manual cleanup (simulating TTL expiry) allows re-acquisition
    const realKv = env.ISR_CACHE;
    const failingKv = new Proxy(realKv, {
      get(target, prop) {
        if (prop === "delete") {
          return () => Promise.reject(new Error("KV delete failed"));
        }
        const value = target[prop as keyof typeof target];
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    }) as typeof realKv;
    const logger: Logger = { warn: vi.fn() };

    // Acquire with the failing KV
    const handle = await acquireLock(failingKv, "/blog/post", logger);
    expect(handle).not.toBeNull();

    // Dispose fails silently (kv.delete throws)
    await handle![Symbol.asyncDispose]();

    // Lock entry still exists because delete failed
    const stored = await realKv.get(lockKey("/blog/post"));
    expect(stored).not.toBeNull();

    // Cannot re-acquire while lock entry persists
    const blocked = await acquireLock(realKv, "/blog/post");
    expect(blocked).toBeNull();

    // Simulate TTL expiry by manually deleting the KV entry
    await realKv.delete(lockKey("/blog/post"));

    // Now the lock can be re-acquired
    const reacquired = await acquireLock(realKv, "/blog/post");
    expect(reacquired).not.toBeNull();

    // Clean up
    await reacquired![Symbol.asyncDispose]();
  });
});
