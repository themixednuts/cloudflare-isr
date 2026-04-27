/**
 * Reverse index that maps cache tags to the set of cache keys tagged with them.
 *
 * Concrete implementation:
 * - {@link TagIndexDOClient} — RPC client that delegates to
 *   {@link ISRTagIndexDO} (Durable Object with SQLite).
 */
export interface TagIndex {
    /** Associate `cacheKey` with `tag`. No-op if already present. */
    addKeyToTag(tag: string, cacheKey: string): Promise<void>;
    /** Associate `cacheKey` with multiple `tags` in a single operation. */
    addKeyToTags(tags: readonly string[], cacheKey: string): Promise<void>;
    /** Return every key associated with `tag`. */
    getKeysByTag(tag: string): Promise<string[]>;
    /** Remove `cacheKey` from `tag`. No-op if not present. */
    removeKeyFromTag(tag: string, cacheKey: string): Promise<void>;
    /** Remove all keys for `tag` in a single operation. */
    removeAllKeysForTag(tag: string): Promise<void>;
}
/**
 * Tag index backed by a Durable Object with SQLite.
 *
 * This client sends every operation to a single global DO instance which
 * persists tag/key pairs in a SQLite table. Provides stronger consistency
 * and avoids KV read-modify-write races.
 */
export declare class TagIndexDOClient<T extends Rpc.DurableObjectBranded | undefined = undefined> implements TagIndex {
    private readonly ns;
    private readonly doName;
    constructor(ns: DurableObjectNamespace<T>, options?: {
        /** Durable Object instance name (default: "global"). */
        name?: string;
    });
    /** Get a fresh stub for the current request context. */
    private stub;
    /** Assert the DO response is OK, throwing a helpful error if not. */
    private assertOk;
    addKeyToTag(tag: string, cacheKey: string): Promise<void>;
    addKeyToTags(tags: readonly string[], cacheKey: string): Promise<void>;
    getKeysByTag(tag: string): Promise<string[]>;
    removeKeyFromTag(tag: string, cacheKey: string): Promise<void>;
    removeAllKeysForTag(tag: string): Promise<void>;
}
