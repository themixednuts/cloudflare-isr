# src/revalidation/ — Tag Invalidation + Distributed Locking

Tag-based cache purge and lock-guarded background revalidation.

## CODE MAP

```
revalidator.ts
  ├─ revalidate()              Lock → render (with timeout) → cache.put → updateTagIndex
  │                            Catch block preserves last-known-good; never deletes on failure
  │                            Background uses 2x renderTimeout; lock released via AsyncDisposable
  ├─ createRevalidator()       Factory → { revalidatePath, revalidateTag }
  ├─ revalidatePath()          cache.delete only; next request triggers SWR miss
  ├─ revalidateTag()           tagIndex.getKeysByTag → parallel delete (max 25) + removeAllKeysForTag
  └─ runWithConcurrency()      Worker pool pattern; errors collected, logged, never thrown

lock.ts
  ├─ acquireLock()             KV.get → null? → KV.put with 60s TTL → AsyncDisposable | null
  │                            Release wrapped in try-catch; TTL is safety net
  └─ createKvLock()            KVNamespace → LockProvider factory

tag-index.ts
  ├─ TagIndex                  Interface: addKeyToTag, addKeyToTags, getKeysByTag, removeKeyFromTag, removeAllKeysForTag
  ├─ TagIndexDOClient          RPC client → calls DO via HTTP fetch
  ├─ stub()                    Creates fresh stub per call (current request context)
  └─ assertOk()                Status-specific errors; 404 → wrangler hints, 500 → includes body

tag-index-do.ts
  ├─ ISRTagIndexDO             Durable Object; SQLite table tag_keys(tag, key) composite PK
  ├─ Routes                    /add, /add-bulk (≤64 tags), /get, /remove, /remove-tag
  ├─ ValidationError           Client errors → 400; JSON parse → 400; internal → 500 generic
  └─ Constructor               CREATE TABLE IF NOT EXISTS (Wrangler migration also exists)
```

## CONVENTIONS

- **Lock is best-effort** — Not atomic; duplicate revalidation harmless; 60s KV TTL minimum
- **Never delete on failure** — `revalidate()` catch preserves last-known-good cache entry
- **Tag updates via `updateTagIndexSafely`** — Swallows errors, logs warning; never throws
- **DO stub freshness** — `stub()` creates new per call; response bodies always cancelled
- **Error tiers in DO** — ValidationError→400, JSON parse→400, internal→500 (never exposes SQL)
- **Concurrency bounds** — `runWithConcurrency` max 25 parallel KV deletes during tag purge
- **Background safety** — `revalidate()` runs in `waitUntil`; must never throw unhandled

## NOTES

- `revalidatePath` deletes cache only (no re-render); next request SWR-misses
- Lock released via `Symbol.asyncDispose` — use `await using` at call site
- DO uses synchronous `sql.exec` (Durable Object SQLite API), not async
- `/add-bulk` validates `Array.isArray(tags)` and `tags.length <= 64`
- Single global DO instance by default (`name: "global"`)
- `revalidate()` timeout: 2x `renderTimeout` for background revalidation
- Tag index avoids KV read-modify-write races via DO+SQLite strong consistency
