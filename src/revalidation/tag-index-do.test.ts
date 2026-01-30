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
});
