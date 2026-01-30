import type { CacheEntry, CacheLayer, CacheLayerResult, Logger } from "../types.ts";
import { logWarn } from "../logger.ts";
import { safeCacheGet } from "../utils.ts";

/**
 * Creates a composed two-tier cache that checks L1 first, then L2.
 *
 * - **L1** (Cache API): per-colo, very fast, not globally consistent.
 * - **L2** (KV): global, eventually consistent, higher latency.
 *
 * On `get`, L1 is checked first. A HIT is returned immediately. On L1 STALE
 * or MISS, L2 is consulted to pick the freshest entry and back-fill L1 when
 * a fresh entry is found there.
 *
 * On `put` and `delete`, both layers are updated in parallel.
 */
export function createTwoTierCache(
  l1: CacheLayer,
  l2: CacheLayer,
  logger?: Logger,
): CacheLayer {
  async function runLayerOps(
    action: "write" | "delete",
    operations: Array<{ layer: "L1" | "L2"; promise: Promise<void> }>,
  ): Promise<void> {
    const results = await Promise.allSettled(operations.map((op) => op.promise));
    for (const [index, result] of results.entries()) {
      const operation = operations[index];
      if (!operation) continue;
      if (result.status === "rejected") {
        logWarn(
          logger,
          `Failed to ${action} ${operation.layer} cache:`,
          result.reason,
        );
      }
    }
  }

  function pickNewestEntry(
    left: CacheEntry | null,
    right: CacheEntry | null,
  ): CacheEntry | null {
    if (!left) return right;
    if (!right) return left;
    return left.metadata.createdAt >= right.metadata.createdAt ? left : right;
  }

  function backfillL1(path: string, entry: CacheEntry): void {
    void l1.put(path, entry).catch((error) => {
      logWarn(logger, "Failed to backfill L1 cache:", error);
    });
  }

  return {
    async get(path: string): Promise<CacheLayerResult> {
      const l1Result = await safeCacheGet({
        get: () => l1.get(path),
        logger,
        label: "L1",
      });

      if (l1Result.status === "HIT") {
        return l1Result;
      }

      const l2Result = await safeCacheGet({
        get: () => l2.get(path),
        logger,
        label: "L2",
      });

      if (l1Result.status === "STALE") {
        if (l2Result.status === "HIT" && l2Result.entry) {
          backfillL1(path, l2Result.entry);
          return l2Result;
        }

        if (l2Result.status === "STALE") {
          const entry = pickNewestEntry(l1Result.entry, l2Result.entry);
          if (!entry) {
            return { entry: null, status: "MISS" };
          }
          return { entry, status: "STALE" };
        }

        return l1Result;
      }

      if (l2Result.status === "HIT" && l2Result.entry) {
        backfillL1(path, l2Result.entry);
        return l2Result;
      }

      if (l2Result.status === "STALE") {
        return l2Result;
      }

      return { entry: null, status: "MISS" };
    },

    async put(path: string, entry: CacheEntry): Promise<void> {
      await runLayerOps("write", [
        { layer: "L1", promise: l1.put(path, entry) },
        { layer: "L2", promise: l2.put(path, entry) },
      ]);
    },

    async delete(path: string): Promise<void> {
      await runLayerOps("delete", [
        { layer: "L1", promise: l1.delete(path) },
        { layer: "L2", promise: l2.delete(path) },
      ]);
    },
  };
}
