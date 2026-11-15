/**
 * Migration 0086 on real D1: the confirmation team. Every order keeps its
 * data and starts unassigned. Who first decided each order and who confirmed
 * it are read from the Event Log the store still keeps (an order older than
 * the log stays unknown, never guessed). The team, its pay and how the store
 * shares orders out start empty. A member removed from the store leaves their
 * orders unassigned and keeps the credit for the work they did.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const plan = async (sql: string) => (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(" | ");
let before: Array<Record<string, unknown>>;

const NEW_COLUMNS = ["assignee_id", "assigned_at", "take_backs", "callback_at", "decided_at", "decided_by", "confirmed_at", "confirmed_by", "unanswered_calls"];
const withoutNew = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !NEW_COLUMNS.includes(key)));

const user = (id: string, role = "staff") =>
  `INSERT INTO users (id, name, email, role, status, created_at, updated_at) VALUES ('${id}', '${id}', '${id}@shop.dz', '${role}', 'active', 1, 1)`;
const order = (id: string, status: string) =>
  `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('${id}', 'N-${id}', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, '${status}', 'home', '${T}', '${T}')`;
let seq = 0;
const event = (orderId: string, type: string, at: string, actor: { kind: string; id: string | null }) =>
  `INSERT INTO business_events (id, type, version, subject_type, subject_id, order_id, actor_kind, actor_id, actor_name, origin, occurred_at, recorded_at, data) VALUES ('e${++seq}', '${type}', 1, 'order', '${orderId}', '${orderId}', '${actor.kind}', ${actor.id ? `'${actor.id}'` : "NULL"}, ${actor.id ? `'${actor.id}'` : "NULL"}, 'dashboard', '${at}', '${at}', '{}')`;
const samira = { kind: "staff", id: "u-samira" };
const karim = { kind: "staff", id: "u-karim" };
const aiForKarim = { kind: "agent", id: "u-karim" };
const system = { kind: "system", id: null };
const checkout = { kind: "shopper", id: null };

beforeAll(async () => {
  d1 = await createTestD1({ before: "0086_confirmation_team.sql" });
  await d1.raw.batch(
    [
      user("u-samira"),
      user("u-karim"),
      user("u-gone"),
      user("u-owner", "admin"),
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', '2026-11-01T00:00:00.000Z')",
      order("o-new", "new"),
      order("o-confirmed", "confirmed"),
      order("o-retried", "confirmed"),
      order("o-cancelled", "cancelled"),
      order("o-reopened", "unreachable"),
      order("o-before-log", "confirmed"),
      order("o-by-system", "cancelled"),
      order("o-by-ai", "confirmed"),
      order("o-gone", "confirmed"),
      event("o-new", "order.created", "2026-11-14T08:00:00.000Z", checkout),
      event("o-confirmed", "order.created", "2026-11-14T08:00:00.000Z", checkout),
      event("o-confirmed", "order.updated", "2026-11-14T08:30:00.000Z", karim),
      event("o-confirmed", "order.confirmed", "2026-11-14T09:00:00.000Z", samira),
      event("o-retried", "order.unreachable", "2026-11-14T09:00:00.000Z", karim),
      event("o-retried", "order.confirmed", "2026-11-14T10:00:00.000Z", samira),
      event("o-cancelled", "order.cancelled", "2026-11-14T09:30:00.000Z", karim),
      event("o-reopened", "order.confirmed", "2026-11-14T09:00:00.000Z", samira),
      event("o-reopened", "order.unreachable", "2026-11-14T11:00:00.000Z", karim),
      event("o-reopened", "order.confirmed", "2026-11-14T12:00:00.000Z", karim),
      event("o-reopened", "order.unreachable", "2026-11-14T13:00:00.000Z", karim),
      event("o-by-system", "order.cancelled", "2026-11-14T09:15:00.000Z", system),
      event("o-by-ai", "order.confirmed", "2026-11-14T09:45:00.000Z", aiForKarim),
      event("o-gone", "order.confirmed", "2026-11-14T09:50:00.000Z", { kind: "staff", id: "u-gone" }),
    ].map((sql) => d1.raw.prepare(sql)),
  );
  before = await all("SELECT * FROM orders ORDER BY id");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const handling = async (id: string) =>
  (await all("SELECT decided_at, decided_by, confirmed_at, confirmed_by FROM orders WHERE id = ?1", id))[0];

describe("migration 0086", () => {
  it("keeps every order as it was, unassigned and with no callback", async () => {
    const after = await all("SELECT * FROM orders ORDER BY id");
    expect(after.map(withoutNew)).toEqual(before);
    for (const row of after) expect(row).toMatchObject({ assignee_id: null, assigned_at: null, take_backs: 0, callback_at: null });
  });

  it("reads who confirmed each order, and when, from the Event Log: the first confirmation", async () => {
    expect(await handling("o-confirmed")).toMatchObject({ confirmed_at: "2026-11-14T09:00:00.000Z", confirmed_by: "u-samira" });
    expect(await handling("o-retried")).toMatchObject({ confirmed_at: "2026-11-14T10:00:00.000Z", confirmed_by: "u-samira" });
    expect(await handling("o-reopened")).toMatchObject({ confirmed_at: "2026-11-14T09:00:00.000Z", confirmed_by: "u-samira" });
  });

  it("credits an AI agent's confirmation to the member it acted for", async () => {
    expect(await handling("o-by-ai")).toMatchObject({ confirmed_at: "2026-11-14T09:45:00.000Z", confirmed_by: "u-karim" });
  });

  it("reads each order's first decision: the first move away from new, whoever made it", async () => {
    expect(await handling("o-retried")).toMatchObject({ decided_at: "2026-11-14T09:00:00.000Z", decided_by: "u-karim" });
    expect(await handling("o-cancelled")).toEqual({ decided_at: "2026-11-14T09:30:00.000Z", decided_by: "u-karim", confirmed_at: null, confirmed_by: null });
    expect(await handling("o-reopened")).toMatchObject({ decided_at: "2026-11-14T09:00:00.000Z", decided_by: "u-samira" });
  });

  it("keeps the time of a decision the system made, and credits no member with it", async () => {
    expect(await handling("o-by-system")).toEqual({ decided_at: "2026-11-14T09:15:00.000Z", decided_by: null, confirmed_at: null, confirmed_by: null });
  });

  it("leaves unknown what the log no longer says, and an order still waiting undecided", async () => {
    const unknown = { decided_at: null, decided_by: null, confirmed_at: null, confirmed_by: null };
    expect(await handling("o-before-log")).toEqual(unknown);
    expect(await handling("o-new")).toEqual(unknown);
  });

  it("starts with no team, no pay, and orders shared out by hand", async () => {
    for (const table of ["team_agents", "team_memberships", "team_pay", "store_team_config"]) {
      expect(await all(`SELECT * FROM ${table}`)).toEqual([]);
    }
  });

  it("leaves a removed member's orders unassigned, and keeps the credit for the work they did", async () => {
    await run("INSERT INTO team_agents (user_id, receiving, created_at, updated_at) VALUES ('u-gone', 1, ?1, ?1)", T);
    await run("INSERT INTO team_pay (id, user_id, kind, amount, valid_from, created_at) VALUES ('p-gone', 'u-gone', 'salary', 30000, '2026-11-01', ?1)", T);
    await run("UPDATE orders SET assignee_id = 'u-gone', assigned_at = ?1 WHERE id = 'o-new'", T);
    await run("DELETE FROM users WHERE id = 'u-gone'");
    expect((await all("SELECT assignee_id FROM orders WHERE id = 'o-new'"))[0]).toEqual({ assignee_id: null });
    expect(await handling("o-gone")).toMatchObject({ confirmed_by: "u-gone" });
    expect(await all("SELECT * FROM team_agents WHERE user_id = 'u-gone'")).toEqual([]);
  });

  it("keeps each time someone is on the team: from the day they joined to the day they left, again when they come back", async () => {
    await run("INSERT INTO team_agents (user_id, receiving, created_at, updated_at) VALUES ('u-owner', 0, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z')");
    expect(await all("SELECT user_id, joined_at, left_at FROM team_memberships WHERE user_id = 'u-owner'")).toEqual([{ user_id: "u-owner", joined_at: "2026-10-01T08:00:00.000Z", left_at: null }]);
    await run("UPDATE team_agents SET receiving = 1 WHERE user_id = 'u-owner'");
    await run("DELETE FROM team_agents WHERE user_id = 'u-owner'");
    const [stint] = await all<{ left_at: string }>("SELECT left_at FROM team_memberships WHERE user_id = 'u-owner'");
    expect(stint!.left_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(stint!.left_at) - Date.now())).toBeLessThan(60_000);
    await run("INSERT INTO team_agents (user_id, receiving, created_at, updated_at) VALUES ('u-owner', 0, ?1, ?1)", T);
    expect(await all("SELECT joined_at, left_at IS NULL AS open FROM team_memberships WHERE user_id = 'u-owner' ORDER BY joined_at")).toEqual([
      { joined_at: "2026-10-01T08:00:00.000Z", open: 0 },
      { joined_at: T, open: 1 },
    ]);
    await expect(run("INSERT INTO team_memberships (id, user_id, joined_at) VALUES ('m-twice', 'u-owner', ?1)", T)).rejects.toThrow(/UNIQUE/);
    await run("DELETE FROM team_agents WHERE user_id = 'u-owner'");
    expect(await all("SELECT * FROM team_memberships WHERE user_id = 'u-owner' AND left_at IS NULL")).toEqual([]);
  });

  it("keeps each member's turn: it grows each time any member gets an order, however it was given", async () => {
    await run("INSERT INTO team_agents (user_id, receiving, created_at, updated_at) VALUES ('u-karim', 1, ?1, ?1), ('u-samira', 0, ?1, ?1)", T);
    const turn = async (id: string) => (await all<{ turn: number | null }>("SELECT turn FROM team_agents WHERE user_id = ?1", id))[0]?.turn;
    expect(await turn("u-karim")).toBeNull();

    await run("UPDATE orders SET assignee_id = 'u-karim', assigned_at = ?1 WHERE id = 'o-new'", T);
    expect(await turn("u-karim")).toBe(1);

    await run(
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at, assignee_id, assigned_at) VALUES ('o-born-assigned', 'N-born', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, 'new', 'home', ?1, ?1, 'u-samira', ?1)",
      T,
    );
    expect(await turn("u-samira")).toBe(2);
    await run("UPDATE orders SET assignee_id = 'u-karim', assigned_at = ?1 WHERE id = 'o-born-assigned'", T);
    expect([await turn("u-karim"), await turn("u-samira")]).toEqual([3, 2]);

    await run("UPDATE orders SET assignee_id = NULL, assigned_at = NULL WHERE id = 'o-new'");
    expect(await turn("u-karim")).toBe(3);

    await run("UPDATE orders SET assignee_id = 'u-owner', assigned_at = ?1 WHERE id = 'o-new'", T);
    expect(await all("SELECT user_id FROM team_agents WHERE user_id = 'u-owner'")).toEqual([]);
    expect([await turn("u-karim"), await turn("u-samira")]).toEqual([3, 2]);
  });

  it("refuses pay below zero, two rates of one kind from the same day, and a negative take-back count", async () => {
    const pay = (id: string, amount: number, from: string) =>
      run(`INSERT INTO team_pay (id, user_id, kind, amount, valid_from, created_at) VALUES ('${id}', 'u-samira', 'per_confirmed', ${amount}, '${from}', ?1)`, T);
    await expect(pay("p-negative", -1, "2026-11-01")).rejects.toThrow();
    await pay("p-1", 100, "2026-11-01");
    await expect(pay("p-twice", 150, "2026-11-01")).rejects.toThrow();
    await pay("p-raise", 150, "2026-12-01");
    await expect(run("UPDATE orders SET take_backs = -1 WHERE id = 'o-new'")).rejects.toThrow();
  });

  it("refuses a take-back with no wait or no limit", async () => {
    const config = (minutes: string, limit: string) =>
      run(`INSERT INTO store_team_config (id, store_id, distribution, take_back_minutes, take_back_limit, created_at, updated_at) VALUES ('cfg', (SELECT id FROM stores LIMIT 1), 'evenly', ${minutes}, ${limit}, ?1, ?1)`, T);
    await run("INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Boutique', ?1, ?1)", T);
    await expect(config("0", "2")).rejects.toThrow();
    await expect(config("15", "0")).rejects.toThrow();
    await config("NULL", "2");
    expect(await all("SELECT distribution, take_back_minutes, take_back_limit FROM store_team_config")).toEqual([{ distribution: "evenly", take_back_minutes: null, take_back_limit: 2 }]);
  });

  it("finds a member's open orders, the orders waiting, the callbacks, and the month's confirmations and deliveries through their indexes", async () => {
    expect(await plan("SELECT id FROM orders WHERE assignee_id = 'u-karim' AND status IN ('new', 'unreachable')")).toContain("orders_assignee");
    expect(await plan("SELECT id FROM orders WHERE assignee_id = 'u-karim' AND status = 'new' ORDER BY created_at DESC, id DESC LIMIT 50")).toMatch(/orders_assignee(?![\s\S]*TEMP B-TREE)/);
    expect(await plan("SELECT id FROM orders WHERE status = 'new' AND assigned_at <= '2026-11-14T12:00:00.000Z'")).toContain("idx_orders_status_created_id");
    expect(await plan("SELECT id FROM orders WHERE status = 'new' AND assignee_id IS NULL")).toContain("idx_orders_status_created_id");
    expect(await plan("SELECT id FROM orders WHERE callback_at IS NOT NULL ORDER BY callback_at")).toContain("orders_callbacks");
    expect(await plan("SELECT confirmed_by, COUNT(*) FROM orders WHERE confirmed_at >= '2026-11-01' AND confirmed_at < '2026-12-01' GROUP BY confirmed_by")).toContain("orders_confirmed");
    expect(await plan("SELECT o.confirmed_by FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.delivered_at >= '2026-11-01' AND s.delivered_at < '2026-12-01'")).toContain("shipments_delivered");
    expect(await plan("SELECT user_id FROM team_memberships WHERE joined_at < '2026-12-01' AND (left_at IS NULL OR left_at >= '2026-11-01')")).toContain("team_memberships_period");
  });
});
