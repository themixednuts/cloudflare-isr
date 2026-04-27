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
export declare class ISRTagIndexDO implements DurableObject {
    private sql;
    constructor(ctx: DurableObjectState, _env: Env);
    fetch(request: Request): Promise<Response>;
}
