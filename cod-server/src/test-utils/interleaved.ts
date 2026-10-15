import type { AppDb } from "@/db";

/**
 * The same database, but its next batch first lets `meanwhile` run — another
 * writer getting in between a read and a write. It makes a race
 * deterministic: hold one writer's batch, let the other in first.
 */
export function interleaved(db: AppDb, meanwhile: () => Promise<unknown>): AppDb {
  let pending = true;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "batch" && pending) {
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
