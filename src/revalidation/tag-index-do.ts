import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object that stores a tag→keys reverse index in SQLite.
 *
 * Provides a simple HTTP API consumed by {@link TagIndexDOClient}:
 *
 * - `POST /add`    — body: `{ tag, key }` — insert a tag/key pair
 * - `GET  /get?tag=<tag>` — return JSON array of keys for the tag
 * - `POST /remove` — body: `{ tag, key }` — delete a tag/key pair
 * - `POST /remove-tag` — body: `{ tag }` — delete all keys for a tag
 *
 * The SQLite table is created automatically via a Wrangler migration
 * (see `wrangler.jsonc`), but the DO also ensures it exists at
 * construction time for safety.
 */
export class ISRTagIndexDO extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS tag_keys (
        tag TEXT NOT NULL,
        key TEXT NOT NULL,
        PRIMARY KEY (tag, key)
      )`,
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/add": {
        const { tag, key } = await request.json<{
          tag: string;
          key: string;
        }>();
        this.sql.exec(
          "INSERT OR IGNORE INTO tag_keys (tag, key) VALUES (?, ?)",
          tag,
          key,
        );
        return new Response("ok");
      }

      case "/add-bulk": {
        const { tags, key } = await request.json<{
          tags: string[];
          key: string;
        }>();
        for (const tag of tags) {
          this.sql.exec(
            "INSERT OR IGNORE INTO tag_keys (tag, key) VALUES (?, ?)",
            tag,
            key,
          );
        }
        return new Response("ok");
      }

      case "/get": {
        const tag = url.searchParams.get("tag") ?? "";
        const rows = this.sql
          .exec("SELECT key FROM tag_keys WHERE tag = ?", tag)
          .toArray();
        const keys = rows.map((r) => r.key as string);
        return Response.json(keys);
      }

      case "/remove": {
        const { tag, key } = await request.json<{
          tag: string;
          key: string;
        }>();
        this.sql.exec(
          "DELETE FROM tag_keys WHERE tag = ? AND key = ?",
          tag,
          key,
        );
        return new Response("ok");
      }

      case "/remove-tag": {
        const { tag } = await request.json<{ tag: string }>();
        this.sql.exec("DELETE FROM tag_keys WHERE tag = ?", tag);
        return new Response("ok");
      }

      default:
        return new Response("Not Found", { status: 404 });
    }
  }
}
