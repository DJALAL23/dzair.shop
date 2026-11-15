/**
 * The confirmation team's reads on real D1 go through indexes: the statements
 * the queries really send are captured and SQLite's plan for each is read, so
 * a change that makes one scan every order fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { listTeamMembers, payroll, teamQueue, teamResults } from "../../../../cod-shared/team/queries";
import { getAllOrders } from "../../../../cod-shared/queries/orders";
import { getOrderStageStats } from "../../../../cod-shared/queries/analytics";
import { shareOutWaiting, takeBackUntouched } from "../../../../cod-shared/team/assign";
import { announceDueCallbacks, setCallback } from "../../../../cod-shared/team/callbacks";

let d1: TestD1;
const SYSTEM = { actor: { kind: "system" as const, id: null, name: null }, origin: "schedule" as const };

beforeAll(async () => {
  d1 = await createTestD1();
  await d1.raw.batch([
    d1.raw.prepare("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('store-plan', 'Boutique', 'ar', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')"),
    d1.raw.prepare("INSERT INTO store_team_config (id, store_id, distribution, take_back_minutes, take_back_limit, created_at, updated_at) VALUES ('cfg', 'store-plan', 'in_turn', 15, 2, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')"),
  ]);
}, 120_000);
afterAll(async () => d1?.dispose());

/** Runs `read` against a database that records every statement it prepares, and gives SQLite's plan for each. */
async function plansOf(read: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<unknown>) {
  const statements: string[] = [];
  const raw = d1.raw;
  const recording = new Proxy(raw, {
    get(target, key) {
      if (key === "prepare") return (query: string) => (statements.push(query), target.prepare(query));
      const value = (target as never)[key] as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  await read(drizzle(recording as D1Database, { schema }));
  const plans: string[] = [];
  for (const statement of statements) {
    if (!/^\s*(select|with)/i.test(statement)) continue;
    const params = (statement.match(/\?/g) ?? []).map(() => null);
    const rows = (await raw.prepare(`EXPLAIN QUERY PLAN ${statement}`).bind(...params).all<{ detail: string }>()).results;
    plans.push(rows.map((row) => row.detail).join(" | "));
  }
  return plans;
}

const scansOrders = (plan: string) => /SCAN (orders|o|w|s|shipments)\b(?! USING)/.test(plan);

describe("the team's reads", () => {
  it.each([
    ["the members and what waits with each", (db: never) => listTeamMembers(db)],
    ["the team's queues", (db: never) => teamQueue(db)],
    ["each member's results over a week", (db: never) => teamResults(db, "2026-11-08", "2026-11-14")],
    ["a month's payroll", (db: never) => payroll(db, "2026-11")],
    ["the callbacks, soonest first", (db: never) => getAllOrders(db, { callback: "set", limit: 25 })],
    ["the orders with nobody", (db: never) => getAllOrders(db, { teamQueue: "unassigned", limit: 25 })],
    ["one member's orders", (db: never) => getAllOrders(db, { assigneeId: "u-samira", limit: 25 })],
    ["one member's counts", (db: never) => getOrderStageStats(db, { archived: "exclude", assigneeId: "u-samira" })],
    ["sharing out", (db: never) => shareOutWaiting(db, new Date(), SYSTEM)],
    ["taking back", (db: never) => takeBackUntouched(db, new Date(), SYSTEM)],
    ["telling the callbacks whose time has come", (db: never) => announceDueCallbacks(db, new Date(), SYSTEM)],
    ["setting a callback", (db: never) => setCallback(db, "o-none", null, SYSTEM)],
  ])("%s never scan every order", async (_, read) => {
    const plans = await plansOf(read as never);
    expect(plans.some((plan) => /\b(orders|o|w|s)\b/.test(plan))).toBe(true);
    for (const plan of plans) expect(scansOrders(plan), plan).toBe(false);
  });
});
