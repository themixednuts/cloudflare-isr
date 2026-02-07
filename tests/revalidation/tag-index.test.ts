import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TagIndexDOClient } from "../../src/revalidation/tag-index.ts";

describe("TagIndexDOClient", () => {
  let tagIndex: TagIndexDOClient;

  async function clearTag(tag: string): Promise<void> {
    const keys = await tagIndex.getKeysByTag(tag);
    await Promise.all(keys.map((key) => tagIndex.removeKeyFromTag(tag, key)));
  }

  beforeEach(async () => {
    tagIndex = new TagIndexDOClient(env.TAG_INDEX, { name: "tag-index-tests" });
    // Clean up tag keys used by tests
    await clearTag("nonexistent");
    await clearTag("blog");
    await clearTag("featured");
  });

  describe("getKeysByTag", () => {
    it("returns [] for unknown tag", async () => {
      const keys = await tagIndex.getKeysByTag("nonexistent");
      expect(keys).toEqual([]);
    });
  });

  describe("addKeyToTag", () => {
    it("adds a key and getKeysByTag returns it", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/hello");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual(["/blog/hello"]);
    });

    it("does not duplicate keys", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/hello");
      await tagIndex.addKeyToTag("blog", "/blog/hello");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual(["/blog/hello"]);
    });

    it("adds multiple distinct keys", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/a");
      await tagIndex.addKeyToTag("blog", "/blog/b");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys.sort()).toEqual(["/blog/a", "/blog/b"].sort());
    });

  });

  describe("removeKeyFromTag", () => {
    it("removes the key from the tag index", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/a");
      await tagIndex.addKeyToTag("blog", "/blog/b");

      await tagIndex.removeKeyFromTag("blog", "/blog/a");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual(["/blog/b"]);
    });

    it("is a no-op when key does not exist under the tag", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/a");
      await tagIndex.removeKeyFromTag("blog", "/blog/nonexistent");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual(["/blog/a"]);
    });
  });

  describe("addKeyToTags", () => {
    it("associates a key with multiple tags in one call", async () => {
      await tagIndex.addKeyToTags(["blog", "featured"], "/blog/hello");
      const blogKeys = await tagIndex.getKeysByTag("blog");
      const featuredKeys = await tagIndex.getKeysByTag("featured");
      expect(blogKeys).toEqual(["/blog/hello"]);
      expect(featuredKeys).toEqual(["/blog/hello"]);
    });

    it("is a no-op for empty tags array", async () => {
      await tagIndex.addKeyToTags([], "/blog/hello");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual([]);
    });
  });

  describe("removeAllKeysForTag", () => {
    it("removes all keys for a tag in a single call", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/a");
      await tagIndex.addKeyToTag("blog", "/blog/b");
      await tagIndex.addKeyToTag("blog", "/blog/c");

      await tagIndex.removeAllKeysForTag("blog");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual([]);
    });

    it("is a no-op for unknown tag", async () => {
      await tagIndex.removeAllKeysForTag("nonexistent");
      const keys = await tagIndex.getKeysByTag("nonexistent");
      expect(keys).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("includes validation error body in thrown error for 400", async () => {
      // Empty tag triggers validation error (400) in the DO
      await expect(tagIndex.addKeyToTag("", "/page")).rejects.toThrow(
        /tag must not be empty/,
      );
    });

    it("includes error body in thrown error for 400 (max tags)", async () => {
      // addKeyToTags with > 64 tags triggers 400
      const tags = Array.from({ length: 65 }, (_, i) => `tag-${i}`);
      await expect(tagIndex.addKeyToTags(tags, "/page")).rejects.toThrow(
        /maximum length of 64/,
      );
    });

    it("throws helpful error mentioning ISRTagIndexDO export when DO returns 404", async () => {
      // Simulate a 404 by calling the DO client's assertOk indirectly.
      // When a DO returns 404 (unknown route), the client must throw a
      // developer-friendly error telling them to export ISRTagIndexDO.
      //
      // We can trigger this by hitting an unknown route on the real DO.
      // The client uses fixed paths, so we test the assertOk logic via
      // a custom stub that simulates a 404 from the DO namespace.
      const fakeNs = {
        idFromName: () => "fake-id",
        get: () => ({
          fetch: async () => new Response("Not Found", { status: 404 }),
        }),
      } as unknown as DurableObjectNamespace;

      const brokenClient = new TagIndexDOClient(fakeNs);

      await expect(brokenClient.getKeysByTag("blog")).rejects.toThrow(
        /Durable Object not found/,
      );
      await expect(brokenClient.getKeysByTag("blog")).rejects.toThrow(
        /Ensure ISRTagIndexDO is exported/,
      );
      await expect(brokenClient.getKeysByTag("blog")).rejects.toThrow(
        /wrangler/i,
      );
    });

    it("throws error with 500 status and generic body from DO", async () => {
      // When the DO returns 500 with "Internal error", the client should
      // include that in its thrown error rather than leaking internal details.
      const fakeNs = {
        idFromName: () => "fake-id",
        get: () => ({
          fetch: async () => new Response("Internal error", { status: 500 }),
        }),
      } as unknown as DurableObjectNamespace;

      const brokenClient = new TagIndexDOClient(fakeNs);

      await expect(brokenClient.addKeyToTag("blog", "/page")).rejects.toThrow(
        /500/,
      );
      await expect(brokenClient.addKeyToTag("blog", "/page")).rejects.toThrow(
        /Internal error/,
      );
    });
  });
});
