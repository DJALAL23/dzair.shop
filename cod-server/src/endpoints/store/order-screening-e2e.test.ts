/**
 * Order Protection at the checkout — real D1, real migrations, the real
 * storefront routes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";
import abandonedStoreRouter from "../abandoned-orders/store-routes";
import { MAX_ORDER_NUMBER_DRAWS } from "../../../../cod-shared/lib/order-number";
import { holdOrder, SPAM_ORDERS_PER_DAY } from "../../../../cod-shared/order-screening/screening";
import type { Condition, RuleAction, RuleMode } from "../../../../cod-shared/order-screening/conditions";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let binding: D1Database;
let limiter: { limit: (o: { key: string }) => Promise<{ success: boolean }> } | undefined;
const T = "2026-11-09T08:00:00.000Z";
const STORE = "store-screening";
const WORKER_IP = "2a06:98c0:3600::103";
const SHOPPER_IP = "41.100.1.1";
const SPAM_PHONE = "0551111111";
const REAL_PHONE = "0662222222";

/** The same database, but statements whose SQL `fails` picks are rejected. */
function failing(fails: (query: string) => boolean): D1Database {
  return new Proxy(d1.raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "prepare") return typeof value === "function" ? (value as Function).bind(target) : value;
      return (query: string) => {
        if (!fails(query)) return target.prepare(query);
        const stub: Record<string, unknown> = { bind: () => stub };
        for (const method of ["run", "all", "raw", "first"]) stub[method] = () => Promise.reject(new Error("INJECTED FAULT"));
        return stub;
      };
    },
  });
}

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: binding, REVIEW_RATE_LIMITER: limiter } as never;
    c.set("storeId", STORE);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
  app.route("/store", abandonedStoreRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  binding = d1.raw;
  limiter = undefined;
  for (const table of ["order_attempts", "order_block_list", "order_rules", "store_order_protection_config", "business_events", "order_products", "stock_movements", "orders", "abandoned_orders", "coupons", "customers", "offers", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  const product = (id: string, price: number) => ({ id, name: `Nom ${id}`, handle: id, price, sku: `SKU-${id}`, status: "ACTIVE" as const, trackInventory: true, inventory: 50, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values([product("robe", 3000), product("sac", 1000)]);
});

afterEach(() => vi.restoreAllMocks());

let serial = 0;
async function rule(action: RuleAction, mode: RuleMode, conditions: Condition[]) {
  serial += 1;
  await d1.db.insert(schema.orderRules).values({ id: `rule-${serial}`, name: `Règle ${serial}`, mode, action, conditionsJson: JSON.stringify(conditions), createdAt: T, updatedAt: T });
  return `rule-${serial}`;
}
const turnOn = () => d1.db.insert(schema.storeOrderProtectionConfig).values({ id: "cfg", storeId: STORE, enabled: true, createdAt: T, updatedAt: T });
const phoneIs = (phone: string): Condition => ({ key: "phone", op: "one_of", value: [phone] });

async function spamRuleOn() {
  await turnOn();
  await rule("spam", "active", [phoneIs(SPAM_PHONE)]);
}

interface OrderInput {
  phone?: string;
  items?: { productId: string; quantity: number }[];
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

async function order({ phone = REAL_PHONE, items = [{ productId: "robe", quantity: 2 }], extra = {}, headers = {} }: OrderInput = {}) {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": WORKER_IP, "X-Forwarded-For": SHOPPER_IP, ...headers },
    body: JSON.stringify({ customerName: "Amel Kaci", phone, wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "12 Rue Didouche", items: items.map((line) => ({ ...line, productName: line.productId })), ...extra }),
  });
  return { status: response.status, headers: Object.fromEntries(response.headers), json: (await response.json()) as any };
}

const count = async (table: string) => (await d1.db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0].n;
const attempts = () => d1.db.select().from(schema.orderAttempts).all();
const inventory = async (id: string) => (await d1.db.select({ inventory: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, id)).get())!.inventory;

describe("with the App off", () => {
  it("places the order and records nothing when it was never set up", async () => {
    await rule("spam", "active", [phoneIs(REAL_PHONE)]);
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
    expect(await attempts()).toEqual([]);
  });

  it("does the same when it is turned off", async () => {
    await d1.db.insert(schema.storeOrderProtectionConfig).values({ id: "cfg", storeId: STORE, enabled: false, createdAt: T, updatedAt: T });
    await rule("spam", "active", [phoneIs(REAL_PHONE)]);
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
    expect(await attempts()).toEqual([]);
  });

  it("does the same when every rule is off", async () => {
    await turnOn();
    await rule("spam", "off", [phoneIs(REAL_PHONE)]);
    expect((await order()).status).toBe(201);
    expect(await attempts()).toEqual([]);
  });
});

describe("a Flag", () => {
  it("places the order and records why", async () => {
    await turnOn();
    const id = await rule("flag", "active", [phoneIs(REAL_PHONE)]);
    const { status, json } = await order();
    expect(status).toBe(201);
    expect(await count("orders")).toBe(1);
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ outcome: "flagged", orderId: json.data.orderId, orderNumber: json.data.orderNumber, phone: REAL_PHONE, ipKey: SHOPPER_IP });
    expect(JSON.parse(attempt.matchesJson)).toEqual([{ ruleId: id, name: expect.any(String), mode: "active", action: "flag" }]);
  });
});

describe("a Trial rule", () => {
  it("changes nothing and is recorded", async () => {
    await turnOn();
    const id = await rule("spam", "trial", [phoneIs(REAL_PHONE)]);
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("accepted");
    expect(JSON.parse(attempt.matchesJson)).toMatchObject([{ ruleId: id, mode: "trial" }]);
  });
});

describe("no rule matches", () => {
  it("records an accepted attempt, so it counts later", async () => {
    await turnOn();
    await rule("spam", "active", [phoneIs(SPAM_PHONE)]);
    expect((await order()).status).toBe(201);
    expect(await attempts()).toMatchObject([{ outcome: "accepted", matchesJson: "[]" }]);
  });
});

describe("a Spam Order", () => {
  beforeEach(spamRuleOn);

  it("is not an order: no order, customer, stock movement or event", async () => {
    const before = await inventory("robe");
    expect((await order({ phone: SPAM_PHONE })).status).toBe(201);
    expect(await count("orders")).toBe(0);
    expect(await count("order_products")).toBe(0);
    expect(await count("customers")).toBe(0);
    expect(await count("stock_movements")).toBe(0);
    expect(await count("business_events")).toBe(0);
    expect(await inventory("robe")).toBe(before);
  });

  it("uses no coupon: a code good for one use still works afterwards", async () => {
    await d1.db.insert(schema.coupons).values({ id: "c", code: "ETE10", kind: "percentage", value: 10, usageLimit: 1, createdAt: T, updatedAt: T });
    expect((await order({ phone: SPAM_PHONE, extra: { couponCode: "ETE10" } })).status).toBe(201);
    const real = await order({ phone: REAL_PHONE, extra: { couponCode: "ETE10" } });
    expect(real.status).toBe(201);
    expect(real.json.data.couponDiscount).toBeGreaterThan(0);
  });

  it("is kept with what is needed to rescue it, and no one-time proof", async () => {
    await order({ phone: SPAM_PHONE, extra: { checkoutKey: "11111111-1111-4111-8111-111111111111", turnstileToken: "one-time-widget-proof", otpToken: "one-time-phone-proof" }, headers: { "User-Agent": "Mozilla/5.0 test" } });
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ outcome: "spam", orderId: null, phone: SPAM_PHONE, ipKey: SHOPPER_IP, checkoutKey: "11111111-1111-4111-8111-111111111111" });
    const submission = JSON.parse(attempt.submissionJson!);
    expect(submission).toMatchObject({ ipAddress: SHOPPER_IP, userAgent: "Mozilla/5.0 test", locale: "fr" });
    expect(submission.data).toMatchObject({ phone: SPAM_PHONE, customerName: "Amel Kaci", wilayaId: 16 });
    expect(submission.data).not.toHaveProperty("turnstileToken");
    expect(submission.data).not.toHaveProperty("otpToken");
  });
});

describe("what the shopper sees of a Spam Order", () => {
  beforeEach(spamRuleOn);

  const shape = (value: unknown): unknown => (Array.isArray(value) ? value.map(shape) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort().map(([key, inner]) => [key, shape(inner)])) : typeof value);
  const masked = (json: any) => ({ ...json, data: { ...json.data, orderId: "id", orderNumber: "number" } });
  const compared = (headers: Record<string, string>) => {
    const { date: _date, ...rest } = headers;
    return rest;
  };

  it("answers exactly as a placed order: status, headers, fields and numbers", async () => {
    const real = await order({ phone: REAL_PHONE });
    const spam = await order({ phone: SPAM_PHONE });
    expect(spam.status).toBe(real.status);
    expect(compared(spam.headers)).toEqual(compared(real.headers));
    expect(masked(spam.json)).toEqual(masked(real.json));
    expect(spam.json.data.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(spam.json.data.orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);
  });

  it("charges the same with a coupon", async () => {
    await d1.db.insert(schema.coupons).values({ id: "c", code: "ETE10", kind: "percentage", value: 10, createdAt: T, updatedAt: T });
    const real = await order({ phone: REAL_PHONE, extra: { couponCode: "ETE10" } });
    const spam = await order({ phone: SPAM_PHONE, extra: { couponCode: "ETE10" } });
    expect(real.json.data.couponDiscount).toBeGreaterThan(0);
    expect(masked(spam.json)).toEqual(masked(real.json));
  });

  it("charges the same with free delivery", async () => {
    await d1.db.insert(schema.coupons).values({ id: "f", code: "LIVRAISON", kind: "free_shipping", value: 0, createdAt: T, updatedAt: T });
    const real = await order({ phone: REAL_PHONE, extra: { couponCode: "LIVRAISON" } });
    const spam = await order({ phone: SPAM_PHONE, extra: { couponCode: "LIVRAISON" } });
    expect(real.json.data.deliveryFee).toBe(0);
    expect(masked(spam.json)).toEqual(masked(real.json));
  });

  it("charges the same with a reward line, and lists it", async () => {
    await d1.db.insert(schema.offers).values({ id: "bxgy", name: "1 robe, 1 sac", triggerProductId: "robe", triggerQuantity: 1, rewardProductId: "sac", rewardQuantity: 1, discountType: "free", status: "active", createdAt: T, updatedAt: T });
    const real = await order({ phone: REAL_PHONE });
    const spam = await order({ phone: SPAM_PHONE });
    expect(masked(spam.json)).toEqual(masked(real.json));
    const lookup = async (number: string, phone: string) => (await statusOf(number, phone)).json.data;
    expect((await lookup(spam.json.data.orderNumber, SPAM_PHONE)).lines.length).toBe((await lookup(real.json.data.orderNumber, REAL_PHONE)).lines.length);
  });

  async function statusOf(orderNumber: string, phone: string) {
    const response = await app.request("/store/orders/status", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": SHOPPER_IP }, body: JSON.stringify({ orderNumber, phone }) });
    return { status: response.status, json: (await response.json()) as any };
  }

  it("looks up exactly as a new order", async () => {
    const real = await order({ phone: REAL_PHONE });
    const spam = await order({ phone: SPAM_PHONE });
    const realStatus = await statusOf(real.json.data.orderNumber, REAL_PHONE);
    const spamStatus = await statusOf(spam.json.data.orderNumber, SPAM_PHONE);
    expect(spamStatus.status).toBe(200);
    expect(shape(spamStatus.json)).toEqual(shape(realStatus.json));
    const { orderNumber: _a, placedAt: _b, ...realRest } = realStatus.json.data;
    const { orderNumber: _c, placedAt: _d, ...spamRest } = spamStatus.json.data;
    expect(spamRest).toEqual(realRest);
  });

  it("refuses a look-up with the wrong phone, as for any order", async () => {
    const spam = await order({ phone: SPAM_PHONE });
    expect((await statusOf(spam.json.data.orderNumber, REAL_PHONE)).status).toBe(404);
  });

  it("answers the same when the form is sent twice, and is kept once", async () => {
    const key = "22222222-2222-4222-8222-222222222222";
    const first = await order({ phone: SPAM_PHONE, extra: { checkoutKey: key } });
    const second = await order({ phone: SPAM_PHONE, extra: { checkoutKey: key } });
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(await count("order_attempts")).toBe(1);
  });

  it("refuses the same checkout key for another phone, as for any order", async () => {
    const key = "33333333-3333-4333-8333-333333333333";
    await order({ phone: SPAM_PHONE, extra: { checkoutKey: key } });
    expect((await order({ phone: REAL_PHONE, extra: { checkoutKey: key } })).status).toBe(409);
  });

  it("leaves the store's config the same, App on or off", async () => {
    const config = async () => (await app.request("/store/config", { headers: { "X-Forwarded-For": SHOPPER_IP } })).text();
    const on = await config();
    await d1.db.delete(schema.storeOrderProtectionConfig);
    await d1.db.delete(schema.orderRules);
    expect(await config()).toBe(on);
  });

  it("finds no ad conversion for it", async () => {
    const spam = await order({ phone: SPAM_PHONE });
    expect((await app.request(`/store/orders/${spam.json.data.orderId}/tracking`)).status).toBe(404);
  });

  it("marks an abandoned checkout as finished, without a link to an order that does not exist", async () => {
    await d1.db.insert(schema.abandonedOrders).values({ id: "ab", sessionId: "s-1", customerName: "A", phone: SPAM_PHONE, status: "pending", createdAt: T, updatedAt: T } as typeof schema.abandonedOrders.$inferInsert);
    const spam = await order({ phone: SPAM_PHONE });
    const response = await app.request("/store/abandoned/s-1/convert", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: spam.json.data.orderId, orderNumber: spam.json.data.orderNumber }) });
    expect(response.status).toBe(200);
    expect(await d1.db.select().from(schema.abandonedOrders).get()).toMatchObject({ status: "converted", convertedOrderId: null, convertedOrderNumber: null });
  });

  it("still links an abandoned checkout to a real order", async () => {
    await d1.db.insert(schema.abandonedOrders).values({ id: "ab", sessionId: "s-2", customerName: "A", phone: REAL_PHONE, status: "pending", createdAt: T, updatedAt: T } as typeof schema.abandonedOrders.$inferInsert);
    const real = await order();
    await app.request("/store/abandoned/s-2/convert", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: real.json.data.orderId, orderNumber: real.json.data.orderNumber }) });
    expect(await d1.db.select().from(schema.abandonedOrders).get()).toMatchObject({ status: "converted", convertedOrderId: real.json.data.orderId, convertedOrderNumber: real.json.data.orderNumber });
  });
});

describe("the shopper's address", () => {
  it("is the one the storefront forwards, never the storefront worker's", async () => {
    await turnOn();
    await rule("flag", "active", [{ key: "ip", op: "one_of", value: [SHOPPER_IP] }]);
    await order();
    expect(await attempts()).toMatchObject([{ outcome: "flagged", ipKey: SHOPPER_IP }]);
    expect((await d1.db.select({ ip: schema.orders.ipAddress }).from(schema.orders).get())!.ip).toBe(SHOPPER_IP);
  });

  it("counts shoppers on their own address, even through one worker", async () => {
    await turnOn();
    await rule("flag", "active", [{ key: "ip_orders", op: "at_least_in_window", value: { count: 2, windowHours: 24 } }]);
    await order({ headers: { "X-Forwarded-For": "41.100.1.1" } });
    await order({ headers: { "X-Forwarded-For": "41.100.1.2" } });
    expect((await attempts()).map((row) => row.outcome)).toEqual(["accepted", "accepted"]);
    await order({ headers: { "X-Forwarded-For": "41.100.1.1" } });
    expect((await attempts()).filter((row) => row.outcome === "flagged")).toHaveLength(1);
  });
});

describe("rules that count", () => {
  it("sends the third order from one phone to Spam, counting Spam Orders too", async () => {
    await turnOn();
    await rule("spam", "active", [{ key: "phone_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }]);
    await order();
    await order();
    expect(await count("orders")).toBe(2);
    await order();
    await order();
    expect(await count("orders")).toBe(2);
    expect((await attempts()).filter((row) => row.outcome === "spam")).toHaveLength(2);
  });

  it("uses the limiter for a burst, by store and network", async () => {
    await turnOn();
    await rule("spam", "active", [{ key: "ip_burst", op: "is_true", value: null }]);
    const limit = vi.fn(async () => ({ success: false }));
    limiter = { limit };
    await order();
    expect(limit).toHaveBeenCalledWith({ key: `order-attempt:${STORE}:${SHOPPER_IP}` });
    expect(await count("orders")).toBe(0);
  });

  it("reads what was bought: products and pieces", async () => {
    await turnOn();
    await rule("flag", "active", [{ key: "product", op: "one_of", value: ["sac"] }, { key: "pieces", op: "at_least", value: 3 }]);
    await order({ items: [{ productId: "robe", quantity: 1 }, { productId: "sac", quantity: 2 }] });
    expect((await attempts())[0].outcome).toBe("flagged");
    await order({ items: [{ productId: "robe", quantity: 5 }] });
    expect((await attempts())[1].outcome).toBe("accepted");
  });

  it("reads what was typed: name, address, wilaya and delivery type", async () => {
    await turnOn();
    await rule("flag", "active", [
      { key: "name", op: "contains_any", value: ["kaci"] },
      { key: "address", op: "contains_any", value: ["didouche"] },
      { key: "wilaya", op: "one_of", value: [16] },
      { key: "delivery_type", op: "one_of", value: ["home"] },
    ]);
    await order();
    expect((await attempts())[0].outcome).toBe("flagged");
  });
});

describe("protection never costs a real order", () => {
  const silence = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("places the order when the rules cannot be read", async () => {
    silence();
    await spamRuleOn();
    binding = failing((query) => /join "order_rules"/i.test(query));
    expect((await order({ phone: SPAM_PHONE })).status).toBe(201);
    expect(await count("orders")).toBe(1);
  });

  it("places the order when a count cannot be read", async () => {
    silence();
    await turnOn();
    await rule("spam", "active", [{ key: "phone_orders", op: "at_least_in_window", value: { count: 1, windowHours: 24 } }]);
    binding = failing((query) => /SUM\(CASE/.test(query));
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
  });

  it("places the order when a Spam Order cannot be kept", async () => {
    silence();
    await spamRuleOn();
    binding = failing((query) => /insert into "?order_attempts/i.test(query));
    expect((await order({ phone: SPAM_PHONE })).status).toBe(201);
    expect(await count("orders")).toBe(1);
  });

  it("keeps the order when its attempt cannot be recorded", async () => {
    silence();
    await turnOn();
    await rule("flag", "active", [phoneIs(REAL_PHONE)]);
    binding = failing((query) => /insert into "?order_attempts/i.test(query));
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
  });

  it("skips one rule it cannot read and keeps the others", async () => {
    await turnOn();
    await d1.db.insert(schema.orderRules).values({ id: "bad", name: "Old", mode: "active", action: "accept", conditionsJson: "[{\"key\":\"gone\"}]", createdAt: T, updatedAt: T });
    await rule("spam", "active", [phoneIs(SPAM_PHONE)]);
    await order({ phone: SPAM_PHONE });
    expect(await count("orders")).toBe(0);
    expect(await count("order_attempts")).toBe(1);
  });

  it("draws another number when a Spam Order's is taken", async () => {
    await spamRuleOn();
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.5);
    const first = await order({ phone: SPAM_PHONE });
    random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const second = await order({ phone: SPAM_PHONE });
    expect(second.status).toBe(201);
    expect(second.json.data.orderNumber).not.toBe(first.json.data.orderNumber);
    expect(await count("orders")).toBe(0);
    expect((await attempts()).filter((row) => row.outcome === "spam")).toHaveLength(2);
  });

  it("never gives a Spam Order the number of a real order", async () => {
    await spamRuleOn();
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.5);
    const real = await order({ phone: REAL_PHONE });
    random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const spam = await order({ phone: SPAM_PHONE });
    expect(spam.status).toBe(201);
    expect(spam.json.data.orderNumber).not.toBe(real.json.data.orderNumber);
    expect(await count("orders")).toBe(1);
  });

  it("never gives a real order the number of a Spam Order", async () => {
    await spamRuleOn();
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.5);
    const spam = await order({ phone: SPAM_PHONE });
    random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const real = await order({ phone: REAL_PHONE });
    expect(real.status).toBe(201);
    expect(real.json.data.orderNumber).not.toBe(spam.json.data.orderNumber);
    expect(await count("orders")).toBe(1);
  });
});

describe("the Block List", () => {
  const block = (kind: "phone" | "ip", value: string) => d1.db.insert(schema.orderBlockList).values({ id: `b-${kind}`, kind, value, createdAt: T });

  it("sends a blocked number to Spam with no rule at all", async () => {
    await turnOn();
    await block("phone", SPAM_PHONE);
    expect((await order({ phone: SPAM_PHONE })).status).toBe(201);
    expect(await count("orders")).toBe(0);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("spam");
    expect(JSON.parse(attempt.matchesJson!)).toEqual([{ ruleId: "block-list:phone", name: "Block List", mode: "active", action: "spam", blockList: "phone" }]);
  });

  it("sends a blocked network to Spam, before an Always accept rule", async () => {
    await turnOn();
    await block("ip", SHOPPER_IP);
    await rule("accept", "active", [phoneIs(REAL_PHONE)]);
    await order({ phone: REAL_PHONE });
    expect(await count("orders")).toBe(0);
    expect((await attempts())[0].outcome).toBe("spam");
  });

  it("does nothing while the App is off", async () => {
    await d1.db.insert(schema.storeOrderProtectionConfig).values({ id: "cfg", storeId: STORE, enabled: false, createdAt: T, updatedAt: T });
    await block("phone", SPAM_PHONE);
    await order({ phone: SPAM_PHONE });
    expect(await count("orders")).toBe(1);
    expect(await attempts()).toEqual([]);
  });

  it("leaves a number that is not on it alone", async () => {
    await turnOn();
    await block("phone", SPAM_PHONE);
    await order({ phone: REAL_PHONE });
    expect(await count("orders")).toBe(1);
    expect(await attempts()).toEqual([]);
  });
});

describe("what the storefront says about a checkout", () => {
  const DEVICE = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
  const INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 307.0.0.34.111";
  const context = (fields: Record<string, unknown> = {}) => JSON.stringify({ d: DEVICE, f: 3000, s: "meta", ...fields });
  const network = encodeURIComponent(JSON.stringify({ c: "DZ" }));
  const sent = { extra: { checkoutContext: context() }, headers: { "User-Agent": INSTAGRAM, "X-Visitor-Network": network } };
  const signals = { fillSeconds: 3, visitSource: "meta", appSource: "instagram", networkCountry: "DZ" };
  const flagOn = async (condition: Condition) => {
    await turnOn();
    await rule("flag", "active", [condition]);
  };

  it.each<[string, Condition]>([
    ["fill time", { key: "fill_seconds", op: "at_most", value: 3 }],
    ["visit source", { key: "visit_source", op: "one_of", value: ["meta"] }],
    ["app", { key: "app_source", op: "one_of", value: ["instagram"] }],
    ["country", { key: "network_country", op: "one_of", value: ["DZ"] }],
    ["country left out", { key: "network_country", op: "not_one_of", value: ["FR"] }],
    ["device", { key: "device_orders", op: "at_least_in_window", value: { count: 1, windowHours: 24 } }],
  ])("a rule on the %s acts", async (_name, condition) => {
    await flagOn(condition);
    expect((await order(sent)).status).toBe(201);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("flagged");
    expect(attempt.deviceKey).toBe(DEVICE);
    expect(JSON.parse(attempt.signalsJson)).toEqual(signals);
  });

  it("sends the third number on one device to Spam, and no earlier one", async () => {
    await turnOn();
    await rule("spam", "active", [{ key: "device_phones", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }]);
    await order({ phone: "0551111111", extra: sent.extra });
    await order({ phone: "0551111111", extra: sent.extra });
    await order({ phone: "0662222222", extra: sent.extra });
    expect(await count("orders")).toBe(3);
    const third = await order({ phone: "0773333333", extra: sent.extra });
    expect(third.status).toBe(201);
    expect(await count("orders")).toBe(3);
    expect((await attempts()).filter((attempt) => attempt.outcome === "spam")).toHaveLength(1);
  });

  it.each<[string, Condition]>([
    ["fill time", { key: "fill_seconds", op: "at_most", value: 100000 }],
    ["visit source", { key: "visit_source", op: "one_of", value: ["other"] }],
    ["country left out", { key: "network_country", op: "not_one_of", value: ["FR"] }],
    ["device", { key: "device_orders", op: "at_least_in_window", value: { count: 1, windowHours: 24 } }],
    ["numbers", { key: "device_phones", op: "at_least_in_window", value: { count: 1, windowHours: 24 } }],
  ])("a storefront that sends nothing never matches a rule on the %s", async (_name, condition) => {
    await turnOn();
    await rule("spam", "active", [condition]);
    expect((await order()).status).toBe(201);
    expect(await count("orders")).toBe(1);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("accepted");
    expect(attempt.deviceKey).toBeNull();
  });

  it.each([["not json"], [""], [7], [{ d: DEVICE }], ["x".repeat(513)], [JSON.stringify({ d: "<script>", f: -5, s: "radio" })]])("still takes the order when the value is %j", async (checkoutContext) => {
    await flagOn({ key: "fill_seconds", op: "at_most", value: 100000 });
    expect((await order({ extra: { checkoutContext } })).status).toBe(201);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("accepted");
    expect(attempt.deviceKey).toBeNull();
  });

  it("still takes the order when the network header is broken", async () => {
    await flagOn({ key: "network_country", op: "one_of", value: ["DZ"] });
    expect((await order({ headers: { "X-Visitor-Network": "%E0%A4%A" } })).status).toBe(201);
    expect((await attempts())[0].outcome).toBe("accepted");
  });

  it("keeps the Signals of a Spam Order, but not the raw value in what it would place", async () => {
    await turnOn();
    await rule("spam", "active", [{ key: "app_source", op: "one_of", value: ["instagram"] }]);
    expect((await order(sent)).status).toBe(201);
    const [attempt] = await attempts();
    expect(attempt.outcome).toBe("spam");
    expect(attempt.deviceKey).toBe(DEVICE);
    expect(JSON.parse(attempt.signalsJson)).toEqual(signals);
    expect(attempt.submissionJson).not.toContain("checkoutContext");
  });

  it("answers a Spam Order and a real one with the same fields", async () => {
    await turnOn();
    await rule("spam", "active", [phoneIs(SPAM_PHONE)]);
    const real = await order(sent);
    const spam = await order({ ...sent, phone: SPAM_PHONE });
    expect(Object.keys(spam.json.data).sort()).toEqual(Object.keys(real.json.data).sort());
    expect(JSON.stringify(spam.json)).not.toContain("meta");
  });
});

describe("keeping a Spam Order", () => {
  const screening = { verdict: "spam" as const, matches: [], phone: SPAM_PHONE, ipKey: SHOPPER_IP, deviceKey: null, signals: {} };
  const answer = { price: 100, deliveryFee: 50, couponDiscount: 0, deliveryType: "home" as const, lines: [] };

  it("answers with the one already kept when another request of the checkout got there first", async () => {
    const key = "44444444-4444-4444-8444-444444444444";
    const first = await holdOrder(d1.db, screening, { checkoutKey: key, submission: {}, answer }, new Date().toISOString());
    const second = await holdOrder(d1.db, screening, { checkoutKey: key, submission: {}, answer }, new Date().toISOString());
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(await count("order_attempts")).toBe(1);
  });

  it("gives up, so the order is placed, when no number can be drawn", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = new Date().toISOString();
    expect(await holdOrder(d1.db, screening, { submission: {}, answer }, now)).not.toBeNull();
    random.mockClear();
    expect(await holdOrder(d1.db, screening, { submission: {}, answer }, now)).toBeNull();
    expect(random).toHaveBeenCalledTimes(MAX_ORDER_NUMBER_DRAWS);
  });
});

describe("what it costs the checkout", () => {
  function recording(): { binding: D1Database; log: string[] } {
    const log: string[] = [];
    return {
      log,
      binding: new Proxy(d1.raw, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop !== "prepare") return typeof value === "function" ? (value as Function).bind(target) : value;
          return (query: string) => {
            log.push(query);
            return target.prepare(query);
          };
        },
      }),
    };
  }
  const touching = (log: string[], pattern: RegExp) => log.filter((query) => pattern.test(query));

  it("is one read and no write with the App off", async () => {
    const { binding: recorded, log } = recording();
    binding = recorded;
    await order();
    expect(touching(log, /"order_rules"/)).toHaveLength(1);
    expect(touching(log, /insert into "?order_attempts/i)).toHaveLength(0);
    expect(touching(log, /order_block_list|SUM\(CASE/)).toHaveLength(0);
  });

  it("is two reads and no write with the App on, no rules and nothing blocked", async () => {
    await turnOn();
    const { binding: recorded, log } = recording();
    binding = recorded;
    await order();
    expect(touching(log, /"order_rules"/)).toHaveLength(1);
    expect(touching(log, /order_block_list/)).toHaveLength(1);
    expect(touching(log, /order_attempts/)).toHaveLength(0);
  });

  it("is at most four reads and one write with every source in use", async () => {
    await turnOn();
    await rule("flag", "active", [{ key: "phone_orders", op: "at_least_in_window", value: { count: 1, windowHours: 24 } }, { key: "ip_orders", op: "at_least_in_window", value: { count: 1, windowHours: 1 } }]);
    await rule("flag", "active", [{ key: "delivered_before", op: "at_least", value: 1 }, { key: "returned_before", op: "at_least", value: 1 }]);
    const { binding: recorded, log } = recording();
    binding = recorded;
    await order();
    expect(touching(log, /"order_rules"/)).toHaveLength(1);
    expect(touching(log, /SUM\(CASE/)).toHaveLength(1);
    expect(touching(log, /order_block_list/)).toHaveLength(1);
    expect(touching(log, /COUNT\(s\.delivered_at\)/)).toHaveLength(1);
    expect(touching(log, /insert into "?order_attempts/i)).toHaveLength(1);
  });
});

describe("a flood", () => {
  async function fill(n: number, createdAt: string) {
    await d1.raw.prepare(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?) INSERT INTO order_attempts (id, created_at, phone, outcome, order_number) SELECT 'fill-' || ?2 || '-' || i, ?2, '0770000000', 'spam', 'ORD-' || ?2 || '-' || i FROM seq`).bind(n, createdAt).run();
  }

  it("answers as usual and saves nothing more once the day's limit is reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await spamRuleOn();
    await fill(SPAM_ORDERS_PER_DAY, new Date().toISOString());
    const { status, json } = await order({ phone: SPAM_PHONE });
    expect(status).toBe(201);
    expect(json.data.orderNumber).toMatch(/^ORD-/);
    expect(await count("order_attempts")).toBe(SPAM_ORDERS_PER_DAY);
    expect(await count("orders")).toBe(0);
  });

  it("does not hold yesterday's flood against today", async () => {
    await spamRuleOn();
    await fill(SPAM_ORDERS_PER_DAY, new Date(Date.now() - 25 * 3_600_000).toISOString());
    await order({ phone: SPAM_PHONE });
    expect(await count("order_attempts")).toBe(SPAM_ORDERS_PER_DAY + 1);
  });
});
