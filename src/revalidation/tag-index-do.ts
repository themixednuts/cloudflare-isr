import { DurableObject } from "cloudflare:workers";

/** Maximum allowed length for tag or key inputs in the DO. */
const MAX_INPUT_LENGTH = 2048;

/** Maximum number of tags allowed in a single /add-bulk request. */
const MAX_BULK_TAGS = 64;

/**
 * Maximum rows returned from a single tag query to prevent DO memory exhaustion.
 * DOs have a 128MB memory limit; an unbounded SELECT could OOM with millions of rows.
 *
 * @see CWE-400 -- Uncontrolled Resource Consumption
 */
const TAG_QUERY_MAX_RESULTS = 10_000;

/** Thrown for client input validation failures (→ 400). */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value || value.length === 0) {
    throw new ValidationError(`${label} must not be empty`);
  }
}

function assertLength(value: string, label: string): void {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new ValidationError(
      `${label} exceeds maximum length of ${MAX_INPUT_LENGTH}`,
    );
  }
}

function validateInput(value: string, label: string): void {
  assertNonEmpty(value, label);
  assertLength(value, label);
}

/**
 * Safely parse a JSON body, throwing a {@link ValidationError} on failure
 * so the caller can distinguish bad input from internal errors.
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

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

    try {
      switch (url.pathname) {
        case "/add": {
          const { tag, key } = await parseJsonBody<{
            tag: string;
            key: string;
          }>(request);
          validateInput(tag, "tag");
          validateInput(key, "key");
          this.sql.exec(
            "INSERT OR IGNORE INTO tag_keys (tag, key) VALUES (?, ?)",
            tag,
            key,
          );
          return new Response("ok");
        }

        case "/add-bulk": {
          const { tags, key } = await parseJsonBody<{
            tags: string[];
            key: string;
          }>(request);
          if (!Array.isArray(tags)) {
            throw new ValidationError("tags must be an array");
          }
          if (tags.length > MAX_BULK_TAGS) {
            throw new ValidationError(
              `tags array exceeds maximum length of ${MAX_BULK_TAGS}`,
            );
          }
          validateInput(key, "key");
          for (const tag of tags) {
            validateInput(tag, "tag");
          }
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
          validateInput(tag, "tag");
          const rows = this.sql
            .exec("SELECT key FROM tag_keys WHERE tag = ? LIMIT ?", tag, TAG_QUERY_MAX_RESULTS)
            .toArray();
          if (rows.length === TAG_QUERY_MAX_RESULTS) {
            console.warn(
              `[ISRTagIndexDO] Tag "${tag.slice(0, 64)}" returned ${TAG_QUERY_MAX_RESULTS} results (limit reached, results truncated)`,
            );
          }
          const keys = rows.map((r) => r.key as string);
          return Response.json(keys);
        }

        case "/remove": {
          const { tag, key } = await parseJsonBody<{
            tag: string;
            key: string;
          }>(request);
          validateInput(tag, "tag");
          validateInput(key, "key");
          this.sql.exec(
            "DELETE FROM tag_keys WHERE tag = ? AND key = ?",
            tag,
            key,
          );
          return new Response("ok");
        }

        case "/remove-tag": {
          const { tag } = await parseJsonBody<{ tag: string }>(request);
          validateInput(tag, "tag");
          this.sql.exec("DELETE FROM tag_keys WHERE tag = ?", tag);
          return new Response("ok");
        }

        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return new Response(error.message, { status: 400 });
      }
      // Internal error — log full details but return generic message
      console.error(`[ISRTagIndexDO] Error handling ${url.pathname}:`, error);
      return new Response("Internal error", { status: 500 });
    }
  }
}
