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
  /** Return every key associated with `tag`. */
  getKeysByTag(tag: string): Promise<string[]>;
  /** Remove `cacheKey` from `tag`. No-op if not present. */
  removeKeyFromTag(tag: string, cacheKey: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// TagIndexDOClient — RPC client → ISRTagIndexDO
// ---------------------------------------------------------------------------

/**
 * Tag index backed by a Durable Object with SQLite.
 *
 * This client sends every operation to a single global DO instance which
 * persists tag/key pairs in a SQLite table. Provides stronger consistency
 * and avoids KV read-modify-write races.
 */
export class TagIndexDOClient<
  T extends Rpc.DurableObjectBranded | undefined = undefined,
> implements TagIndex {
  private readonly stub: DurableObjectStub<T>;

  constructor(
    ns: DurableObjectNamespace<T>,
    options?: {
      /** Durable Object instance name (default: "global"). */
      name?: string;
    },
  ) {
    const name = options?.name ?? "global";
    this.stub = ns.get(ns.idFromName(name));
  }

  async addKeyToTag(tag: string, cacheKey: string): Promise<void> {
    const res = await this.stub.fetch("http://do/add", {
      method: "POST",
      body: JSON.stringify({ tag, key: cacheKey }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`TagIndexDO add failed: ${res.status}`);
    await res.body?.cancel();
  }

  async getKeysByTag(tag: string): Promise<string[]> {
    const res = await this.stub.fetch(
      `http://do/get?tag=${encodeURIComponent(tag)}`,
    );
    if (!res.ok) throw new Error(`TagIndexDO get failed: ${res.status}`);
    return res.json();
  }

  async removeKeyFromTag(tag: string, cacheKey: string): Promise<void> {
    const res = await this.stub.fetch("http://do/remove", {
      method: "POST",
      body: JSON.stringify({ tag, key: cacheKey }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`TagIndexDO remove failed: ${res.status}`);
    await res.body?.cancel();
  }
}
