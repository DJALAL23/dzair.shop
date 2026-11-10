/**
 * The Order Protection App through the merchant's API, on real D1.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { RULE_LIMITS } from "../../../../cod-shared/order-screening/conditions";
import { holdOrder } from "../../../../cod-shared/order-screening/screening";
import { ORDER_ATTEMPT_DAYS, SPAM_ORDER_DAYS, sweepOrderAttempts } from "../../../../cod-shared/queries/order-protection";
import appsRouter from "./routes";
import ordersRouter from "../orders/routes";

let d1: TestD1;
let admin: Api;
const T = "2026-11-09T08:00:00.000Z";
const STORE = "s1";
const PHONE = "0551234567";
const routers = { "/api/apps": appsRouter, "/api/orders": ordersRouter };
const as = (scopes: string[]) => apiAs(d1, staff(scopes), routers);
const BASE = "/api/apps/order-protection";
const RULE = { name: "Trop de pièces", mode: "trial", action: "flag", conditions: [{ key: "pieces", op: "at_least", value: 5 }] };

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, routers);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["order_attempts", "order_block_list", "order_rules", "store_order_protection_config", "business_events", "order_products", "stock_movements", "orders", "customers", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "SKU-robe", status: "ACTIVE", trackInventory: true, inventory: 5, createdAt: T, updatedAt: T });
});

async function spamOrder(quantity = 2, overrides: Record<string, unknown> = {}) {
  const held = await holdOrder(
    d1.db,
    { verdict: "spam", matches: [{ ruleId: "r", name: "Bloqué", mode: "active", action: "spam" }], phone: PHONE, ipKey: "41.100.1.1", deviceKey: null, signals: { visitSource: "tiktok", fillSeconds: 2 } },
    {
      submission: { data: { customerName: "Amel Kaci", phone: PHONE, wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue", items: [{ productId: "robe", productName: "Robe", quantity }], ...overrides }, customFieldAnswers: [], locale: "fr", ipAddress: "41.100.1.1", userAgent: "UA" },
      answer: { price: 3000 * quantity, deliveryFee: 600, couponDiscount: 0, deliveryType: "home", lines: [{ name: "Robe", variantLabel: null, quantity }] },
    },
    new Date().toISOString(),
  );
  return held!;
}

const attempt = async (id: string) => (await d1.db.select().from(schema.orderAttempts).where(eq(schema.orderAttempts.id, id)).get())!;
const count = async (table: string) => (await d1.db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0].n;

describe("who may see and change it", () => {
  it("takes read to see and manage to change", async () => {
    expect((await as(["turnstile:read"]).get(BASE)).status).toBe(403);
    const reader = as(["order-protection:read"]);
    expect((await reader.get(BASE)).status).toBe(200);
    expect((await reader.get(`${BASE}/block-list`)).status).toBe(200);
    expect((await reader.get(`${BASE}/attempts`)).status).toBe(200);
    expect((await reader.put(BASE, { enabled: true })).status).toBe(403);
    expect((await reader.post(`${BASE}/template`, { key: "empty" })).status).toBe(403);
    expect((await reader.post(`${BASE}/rules`, RULE)).status).toBe(403);
    expect((await reader.post(`${BASE}/block-list`, { kind: "phone", value: PHONE })).status).toBe(403);
    expect((await reader.post(`${BASE}/spam/x/rescue`)).status).toBe(403);
    expect((await reader.delete(`${BASE}/spam/x`)).status).toBe(403);
    expect((await as(["order-protection:manage"]).put(BASE, { enabled: true })).status).toBe(200);
  });
});

describe("the App's state", () => {
  it("is not set up at first", async () => {
    expect((await admin.get(BASE)).body.data).toEqual({ enabled: null, rules: [] });
    expect((await admin.get("/api/apps")).body.data.find((app: any) => app.key === "order-protection").status).toBe("not_set_up");
  });

  it("is on once a Template is chosen, in the store's language", async () => {
    const { status, body } = await admin.post(`${BASE}/template`, { key: "recommended" });
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.rules).toHaveLength(8);
    expect(body.data.rules[0]).toMatchObject({ name: "Clients déjà livrés", templateRule: "good_customer" });
    expect((await admin.get("/api/apps")).body.data.find((app: any) => app.key === "order-protection").status).toBe("on");
  });

  it("turns off and keeps the rules", async () => {
    await admin.post(`${BASE}/template`, { key: "recommended" });
    expect((await admin.put(BASE, { enabled: false })).body.data).toEqual({ enabled: false });
    const { body } = await admin.get(BASE);
    expect(body.data.enabled).toBe(false);
    expect(body.data.rules).toHaveLength(8);
    expect((await admin.get("/api/apps")).body.data.find((app: any) => app.key === "order-protection").status).toBe("off");
  });

  it("refuses an unknown Template", async () => {
    expect((await admin.post(`${BASE}/template`, { key: "nope" })).status).toBe(400);
  });

  it("cannot be removed, only turned off", () => {
    expect(appsRouter.routes.some((route) => route.method === "DELETE" && route.path === "/order-protection")).toBe(false);
  });
});

describe("rules", () => {
  it("creates, changes, switches and deletes", async () => {
    const created = await admin.post(`${BASE}/rules`, RULE);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "Trop de pièces", mode: "trial", matchesLastWeek: 0 });
    const id = created.body.data.id;
    expect((await admin.put(`${BASE}/rules/${id}`, { ...RULE, action: "spam" })).body.data.action).toBe("spam");
    expect((await admin.patch(`${BASE}/rules/${id}/mode`, { mode: "active" })).body.data.mode).toBe("active");
    expect((await admin.delete(`${BASE}/rules/${id}`)).status).toBe(200);
    expect((await admin.get(BASE)).body.data.rules).toEqual([]);
  });

  it("says why a rule is refused", async () => {
    const { status, body } = await admin.post(`${BASE}/rules`, { ...RULE, conditions: [{ key: "gone", op: "x", value: 1 }] });
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.context).toMatchObject({ reason: "UNKNOWN_CONDITION", conditionIndex: 0 });
    expect((await admin.put(`${BASE}/rules/x`, { ...RULE, action: "explode" })).status).toBe(400);
  });

  it("answers 404 for a rule that does not exist", async () => {
    expect((await admin.put(`${BASE}/rules/x`, RULE)).status).toBe(404);
    expect((await admin.patch(`${BASE}/rules/x/mode`, { mode: "off" })).body.code).toBe(ERROR_CODES.ORDER_RULE_NOT_FOUND);
    expect((await admin.delete(`${BASE}/rules/x`)).status).toBe(404);
  });

  it("stops at the limit", async () => {
    await d1.raw.prepare(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?) INSERT INTO order_rules (id, name, mode, action, conditions_json, created_at, updated_at) SELECT 'r' || i, 'x', 'off', 'flag', '[]', '${T}', '${T}' FROM seq`).bind(RULE_LIMITS.rules).run();
    const { status, body } = await admin.post(`${BASE}/rules`, RULE);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.code).toBe(ERROR_CODES.ORDER_RULE_LIMIT_REACHED);
  });

  it("shows what each rule matched in the last week", async () => {
    const id = (await admin.post(`${BASE}/rules`, RULE)).body.data.id;
    const matches = JSON.stringify([{ ruleId: id, name: "x", mode: "trial", action: "flag" }]);
    await d1.db.insert(schema.orderAttempts).values([
      { id: "a1", createdAt: new Date().toISOString(), phone: PHONE, outcome: "accepted", matchesJson: matches },
      { id: "a2", createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), phone: PHONE, outcome: "accepted", matchesJson: matches },
    ]);
    expect((await admin.get(BASE)).body.data.rules[0].matchesLastWeek).toBe(1);
  });
});

describe("the Block List", () => {
  it("stores a value in the form it is compared in", async () => {
    const phone = await admin.post(`${BASE}/block-list`, { kind: "phone", value: "+213 551 234 567", note: " faux " });
    expect(phone.status).toBe(201);
    expect(phone.body.data).toMatchObject({ kind: "phone", value: PHONE, note: "faux" });
    expect((await admin.post(`${BASE}/block-list`, { kind: "ip", value: "2001:db8:1:2:a:b:c:d" })).body.data.value).toBe("2001:db8:1:2::/64");
  });

  it("refuses what cannot be blocked", async () => {
    expect((await admin.post(`${BASE}/block-list`, { kind: "phone", value: "abc" })).status).toBe(400);
    expect((await admin.post(`${BASE}/block-list`, { kind: "ip", value: "1.2.3" })).status).toBe(400);
  });

  it("lists, filters and removes", async () => {
    await admin.post(`${BASE}/block-list`, { kind: "phone", value: PHONE });
    const ip = await admin.post(`${BASE}/block-list`, { kind: "ip", value: "41.100.1.1" });
    expect((await admin.get(`${BASE}/block-list?kind=ip`)).body).toMatchObject({ total: 1, data: [{ value: "41.100.1.1" }] });
    expect((await admin.delete(`${BASE}/block-list/${ip.body.data.id}`)).status).toBe(200);
    expect((await admin.delete(`${BASE}/block-list/${ip.body.data.id}`)).body.code).toBe(ERROR_CODES.BLOCK_LIST_ENTRY_NOT_FOUND);
  });

  it("stops at the limit", async () => {
    await d1.raw.prepare(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?) INSERT INTO order_block_list (id, kind, value, created_at) SELECT 'b' || i, 'phone', 'v' || i, '${T}' FROM seq`).bind(RULE_LIMITS.blockList).run();
    expect((await admin.post(`${BASE}/block-list`, { kind: "phone", value: PHONE })).body.code).toBe(ERROR_CODES.BLOCK_LIST_LIMIT_REACHED);
  });
});

describe("the Spam page", () => {
  it("lists Spam Orders with their name, total and why, and nothing else", async () => {
    const held = await spamOrder();
    await d1.db.insert(schema.orderAttempts).values({ id: "other", createdAt: T, phone: PHONE, outcome: "accepted" });
    const { body } = await admin.get(`${BASE}/attempts?outcome=spam`);
    expect(body.data[0].signals).toEqual({ visitSource: "tiktok", fillSeconds: 2 });
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({ id: held.orderId, customerName: "Amel Kaci", total: 6600, phone: PHONE, outcome: "spam", matches: [{ name: "Bloqué" }] });
    expect(body.data[0]).toMatchObject({ wilayaId: 16, communeId: "c-16-001", deliveryType: "home", lines: [{ name: "Robe", variantLabel: null, quantity: 2 }], phoneBlocked: false, ipBlocked: false });
    await admin.post(`${BASE}/block-list`, { kind: "phone", value: PHONE });
    expect((await admin.get(`${BASE}/attempts?outcome=spam`)).body.data[0]).toMatchObject({ phoneBlocked: true, ipBlocked: false });
    expect(JSON.stringify(body)).not.toContain("submission");
  });

  it("deletes a Spam Order, and only a Spam Order", async () => {
    const held = await spamOrder();
    await d1.db.insert(schema.orderAttempts).values({ id: "other", createdAt: T, phone: PHONE, outcome: "accepted" });
    expect((await admin.delete(`${BASE}/spam/${held.orderId}`)).status).toBe(200);
    expect((await admin.delete(`${BASE}/spam/${held.orderId}`)).body.code).toBe(ERROR_CODES.SPAM_ORDER_NOT_FOUND);
    expect((await admin.delete(`${BASE}/spam/other`)).status).toBe(404);
    expect(await count("order_attempts")).toBe(1);
  });
});

describe("Rescue", () => {
  it("makes a real order, with its number, its customer, its stock and its event", async () => {
    const held = await spamOrder();
    const { status, body } = await admin.post(`${BASE}/spam/${held.orderId}/rescue`);
    expect(status).toBe(201);
    expect(body.data.orderNumber).toBe(held.orderNumber);
    const order = (await d1.db.select().from(schema.orders).get())!;
    expect(order).toMatchObject({ id: body.data.orderId, orderNumber: held.orderNumber, phone: PHONE, status: "new", price: 6000, deliveryFee: 600, ipAddress: "41.100.1.1", userAgent: "UA", locale: "fr" });
    expect(await count("customers")).toBe(1);
    expect((await d1.db.select({ inventory: schema.products.inventory }).from(schema.products).get())!.inventory).toBe(3);
    expect(await d1.db.select({ type: schema.businessEvents.type }).from(schema.businessEvents).all()).toEqual([{ type: "order.created" }]);
    expect(await attempt(held.orderId)).toMatchObject({ outcome: "rescued", orderId: order.id, orderNumber: held.orderNumber, submissionJson: null });
  });

  it("uses today's price, not the one kept", async () => {
    const held = await spamOrder();
    await d1.db.update(schema.products).set({ price: 4000 });
    await admin.post(`${BASE}/spam/${held.orderId}/rescue`);
    expect((await d1.db.select().from(schema.orders).get())!.price).toBe(8000);
  });

  it("makes one order when asked twice", async () => {
    const held = await spamOrder();
    expect((await admin.post(`${BASE}/spam/${held.orderId}/rescue`)).status).toBe(201);
    const second = await admin.post(`${BASE}/spam/${held.orderId}/rescue`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe(ERROR_CODES.SPAM_ORDER_ALREADY_RESCUED);
    expect(await count("orders")).toBe(1);
  });

  it("makes one order when asked twice at once", async () => {
    const held = await spamOrder();
    const answers = await Promise.all([admin.post(`${BASE}/spam/${held.orderId}/rescue`), admin.post(`${BASE}/spam/${held.orderId}/rescue`)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    expect(await count("orders")).toBe(1);
  });

  it("refuses with the reason when stock has run out, and the order waits in Spam", async () => {
    const held = await spamOrder(6);
    const { status, body } = await admin.post(`${BASE}/spam/${held.orderId}/rescue`);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);
    expect(await count("orders")).toBe(0);
    expect(await count("customers")).toBe(0);
    expect(await attempt(held.orderId)).toMatchObject({ outcome: "spam", orderId: null });
    expect((await attempt(held.orderId)).submissionJson).not.toBeNull();
  });

  it("can be tried again once the stock is back", async () => {
    const held = await spamOrder(6);
    await admin.post(`${BASE}/spam/${held.orderId}/rescue`);
    await d1.db.update(schema.products).set({ inventory: 10 });
    expect((await admin.post(`${BASE}/spam/${held.orderId}/rescue`)).status).toBe(201);
  });

  it("answers 404 for something that is not a Spam Order", async () => {
    await d1.db.insert(schema.orderAttempts).values({ id: "other", createdAt: T, phone: PHONE, outcome: "accepted" });
    expect((await admin.post(`${BASE}/spam/other/rescue`)).body.code).toBe(ERROR_CODES.SPAM_ORDER_NOT_FOUND);
    expect((await admin.post(`${BASE}/spam/none/rescue`)).status).toBe(404);
  });
});

describe("a flagged order", () => {
  async function placed(id: string, outcome: "flagged" | "accepted") {
    await d1.db.insert(schema.customers).values({ id: `c-${id}`, name: "A", phone: `07700000${id}`, wilaya: "Alger", createdAt: T }).onConflictDoNothing();
    await d1.db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId: `c-${id}`, customerName: "A", phone: PHONE, price: 1, createdAt: T, updatedAt: T });
    await d1.db.insert(schema.orderAttempts).values({ id: `a-${id}`, createdAt: T, phone: PHONE, ipKey: "41.100.1.1", outcome, orderId: id, orderNumber: `ORD-${id}`, matchesJson: JSON.stringify([{ ruleId: "r", name: "Trop", mode: "active", action: "flag" }]) });
  }

  it("is marked in the list, and can be listed alone", async () => {
    await placed("10", "flagged");
    await placed("11", "accepted");
    const all = (await admin.get("/api/orders")).body.data;
    expect(all.find((order: any) => order.id === "10").flagged).toBe(1);
    expect(all.find((order: any) => order.id === "11").flagged).toBe(0);
    expect(all.find((order: any) => order.id === "10").flagReasons).toEqual([{ ruleId: "r", name: "Trop", mode: "active", action: "flag" }]);
    expect(all.find((order: any) => order.id === "11").flagReasons).toEqual([]);
    const only = (await admin.get("/api/orders?flagged=true")).body.data;
    expect(only.map((order: any) => order.id)).toEqual(["10"]);
  });

  it("says why", async () => {
    await placed("10", "flagged");
    expect((await admin.get(`${BASE}/orders/10`)).body.data).toMatchObject({ outcome: "flagged", ipKey: "41.100.1.1", phone: PHONE, matches: [{ name: "Trop" }] });
    expect((await admin.get(`${BASE}/orders/none`)).body.data).toBeNull();
  });

  it("keeps its attempt when the order is deleted, without the link", async () => {
    await placed("10", "flagged");
    await d1.db.delete(schema.orders).where(eq(schema.orders.id, "10"));
    expect(await attempt("a-10")).toMatchObject({ orderId: null, outcome: "flagged" });
  });
});

describe("forgetting old attempts", () => {
  const NOW = new Date("2026-11-09T12:00:00.000Z");
  const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs).toISOString();
  let n = 0;
  const row = (createdAt: string, outcome: "spam" | "accepted" | "flagged" | "rescued") => ({ id: `w${(n += 1)}`, createdAt, phone: PHONE, outcome, ...(outcome === "spam" ? { orderNumber: `ORD-W-${n}` } : {}) });

  it("drops Spam Orders after their days and other attempts after theirs, and nothing sooner", async () => {
    const keptSpam = row(daysAgo(SPAM_ORDER_DAYS), "spam");
    const oldSpam = row(daysAgo(SPAM_ORDER_DAYS, 1), "spam");
    const keptOther = row(daysAgo(ORDER_ATTEMPT_DAYS), "accepted");
    const oldOther = row(daysAgo(ORDER_ATTEMPT_DAYS, 1), "rescued");
    const youngOther = row(daysAgo(SPAM_ORDER_DAYS + 1), "flagged");
    await d1.db.insert(schema.orderAttempts).values([keptSpam, oldSpam, keptOther, oldOther, youngOther]);
    await sweepOrderAttempts(d1.db, NOW);
    expect((await d1.db.select({ id: schema.orderAttempts.id }).from(schema.orderAttempts).all()).map((r) => r.id).sort()).toEqual([keptSpam.id, keptOther.id, youngOther.id].sort());
  });

  it("does not touch the order an attempt led to", async () => {
    await d1.db.insert(schema.customers).values({ id: "c", name: "A", phone: PHONE, wilaya: "Alger", createdAt: T });
    await d1.db.insert(schema.orders).values({ id: "o", orderNumber: "ORD-O", customerId: "c", customerName: "A", phone: PHONE, price: 1, createdAt: T, updatedAt: T });
    await d1.db.insert(schema.orderAttempts).values({ id: "old", createdAt: daysAgo(ORDER_ATTEMPT_DAYS + 5), phone: PHONE, outcome: "rescued", orderId: "o" });
    await sweepOrderAttempts(d1.db, NOW);
    expect(await count("order_attempts")).toBe(0);
    expect(await count("orders")).toBe(1);
  });

  it("works in bounded batches", async () => {
    await d1.raw.prepare(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 600) INSERT INTO order_attempts (id, created_at, phone, outcome) SELECT 'bulk' || i, ?, '${PHONE}', 'accepted' FROM seq`).bind(daysAgo(ORDER_ATTEMPT_DAYS + 5)).run();
    await sweepOrderAttempts(d1.db, NOW);
    expect(await count("order_attempts")).toBe(100);
  });
});
