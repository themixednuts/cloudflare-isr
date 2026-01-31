import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TagIndexDOClient } from "./tag-index.ts";

describe("TagIndexDOClient + ISRTagIndexDO", () => {
  let tagIndex: TagIndexDOClient;

  async function clearTag(tag: string): Promise<void> {
    const keys = await tagIndex.getKeysByTag(tag);
    await Promise.all(keys.map((key) => tagIndex.removeKeyFromTag(tag, key)));
  }

  beforeEach(async () => {
    tagIndex = new TagIndexDOClient(env.TAG_INDEX, { name: "tag-index-do-tests" });
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

    it("does not duplicate keys (INSERT OR IGNORE)", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/hello");
      await tagIndex.addKeyToTag("blog", "/blog/hello");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toEqual(["/blog/hello"]);
    });

    it("adds multiple distinct keys", async () => {
      await tagIndex.addKeyToTag("blog", "/blog/a");
      await tagIndex.addKeyToTag("blog", "/blog/b");
      const keys = await tagIndex.getKeysByTag("blog");
      expect(keys).toContain("/blog/a");
      expect(keys).toContain("/blog/b");
      expect(keys).toHaveLength(2);
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
});
