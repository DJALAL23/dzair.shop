/**
 * What one invocation may still spend (ADR 0017). A Worker on the Free plan
 * may make 50 external subrequests and 1,000 to Cloudflare services (D1,
 * Queues) per invocation; the drain counts what it really spends, through
 * this database and this fetch, and starts a unit of work only when its worst
 * case still fits. Paid accounts run the same budget per invocation and
 * simply get more invocations.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";

export interface Cost {
  external: number;
  services: number;
}

/** Below the Free plan's limits, with room for the wake a drain may send when it stops. */
export const DRAIN_BUDGET: Cost = { external: 45, services: 900 };

/**
 * The five-minute schedule's drain: what its carrier passes leave of the same
 * invocation (ten lookups, a few history reads per company, their D1 trips).
 * More than this is woken onto the queue, whose drain has an invocation of its
 * own; when the queue cannot take it, the schedule still moves this much.
 */
export const SCHEDULED_DRAIN_BUDGET: Cost = { external: 20, services: 300 };

export interface Meter {
  /** The store's database, counted. */
  db: AppDb;
  /** fetch, counted. */
  fetch: typeof fetch;
  /** Whether a unit of work that may cost up to `cost` still fits. */
  fits(cost: Cost): boolean;
  spent(): Cost;
}

/**
 * The D1 binding, calling `onTrip` for each trip to the database: a statement
 * run on its own, or a whole batch. A batch is handed the statements it was
 * given, never the counting wrappers, which D1 would refuse.
 */
export function countTrips(raw: D1Database, onTrip: () => void): D1Database {
  const targets = new WeakMap<object, D1PreparedStatement>();
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop, t);
        if (prop === "bind") return (...args: unknown[]) => statement(value.apply(t, args));
        if (prop === "all" || prop === "run" || prop === "first" || prop === "raw") return (...args: unknown[]) => (onTrip(), value.apply(t, args));
        return typeof value === "function" ? value.bind(t) : value;
      },
    });
    targets.set(proxy, target);
    return proxy;
  };
  return new Proxy(raw, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (prop === "prepare") return (sql: string) => statement(value.call(t, sql));
      if (prop === "batch") return (statements: D1PreparedStatement[]) => (onTrip(), value.call(t, statements.map((s) => targets.get(s) ?? s)));
      if (prop === "exec") return (sql: string) => (onTrip(), value.call(t, sql));
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

export function createMeter(d1: D1Database, budget: Cost = DRAIN_BUDGET, outbound: typeof fetch = fetch): Meter {
  const spent: Cost = { external: 0, services: 0 };
  const database = countTrips(d1, () => {
    spent.services += 1;
  });
  return {
    db: drizzle(database, { schema }) as unknown as AppDb,
    fetch: ((input, init) => {
      spent.external += 1;
      return outbound(input, init);
    }) as typeof fetch,
    fits: (cost) => spent.external + cost.external <= budget.external && spent.services + cost.services <= budget.services,
    spent: () => ({ ...spent }),
  };
}
