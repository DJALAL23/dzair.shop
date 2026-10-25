import type { AppDb } from "@/db";

/**
 * The same database, but its next batch first lets `meanwhile` run — another
 * writer getting in between a read and a write. It makes a race
 * deterministic: hold one writer's batch, let the other in first. With
 * `atBatch`, the hold is on that batch (1 is the next one), for a writer that
 * reads in a batch of its own before it writes.
 */
export function interleaved(db: AppDb, meanwhile: () => Promise<unknown>, { atBatch = 1 }: { atBatch?: number } = {}): AppDb {
  let batches = 0;
  let pending = true;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "batch" && pending && ++batches === atBatch) {
        return async (statements: unknown) => {
          pending = false;
          await meanwhile();
          return (target.batch as (s: unknown) => Promise<unknown>)(statements);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AppDb;
}
