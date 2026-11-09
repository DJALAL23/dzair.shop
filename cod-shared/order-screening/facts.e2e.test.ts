import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppDb } from "../db/client";
import * as schema from "@/db/schema";
import type { Condition } from "./conditions";
import { loadFacts, type OrderSubmission } from "./facts";
import type { Rule } from "./rules";
import { templateRules } from "./templates";
import { addToBlockList, applyTemplate, countBlockList, countRules, createRule, deleteRule, getProtectionConfig, getRule, listBlockList, listRules, removeFromBlockList, ruleMatchCounts, setProtectionEnabled, setRuleMode, updateRule } from "../queries/order-protection";

let d1: TestD1;
const NOW = "2026-11-09T12:00:00.000Z";
const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
const PHONE = "0551234567";
const IP = "41.100.1.1";

const submission: OrderSubmission = { storeId: "s1", phone: PHONE, ip: IP, name: "Amel", address: "Rue", wilayaId: 16, productIds: ["p1"], pieces: 1, deliveryType: "home" };
const rulesOf = (...conditions: Condition[]): Rule[] => [{ id: "r", name: "R", mode: "active", action: "flag", conditions }];
const countOf = (key: "phone_orders" | "ip_orders", windowHours: number, n = 1): Condition => ({ key, op: "at_least_in_window", value: { count: n, windowHours } });

let serial = 0;
const attempt = (phone: string, ipKey: string | null, createdAt: string, outcome: "accepted" | "flagged" | "spam" | "rescued" = "accepted") =>
  d1.db.insert(schema.orderAttempts).values({ id: `a${(serial += 1)}`, createdAt, phone, ipKey, outcome, ...(outcome === "spam" ? { orderNumber: `ORD-${serial}` } : {}) });

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.orderAttempts);
  await d1.db.delete(schema.orderBlockList);
  await d1.db.delete(schema.orderRules);
  await d1.db.delete(schema.storeOrderProtectionConfig);
  await d1.db.delete(schema.shipments);
  await d1.db.delete(schema.drivers);
  await d1.db.delete(schema.orderProducts);
  await d1.db.delete(schema.orders);
  await d1.db.delete(schema.customers);
  await d1.db.delete(schema.stores);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: NOW, updatedAt: NOW });
});

describe("counting attempts", () => {
  it("counts this attempt too, so the third order reads 3", async () => {
    await attempt(PHONE, IP, hoursAgo(1));
    await attempt(PHONE, IP, hoursAgo(2));
    expect((await loadFacts(d1.db, rulesOf(countOf("phone_orders", 24)), submission, {}, NOW)).windowCounts).toEqual({ "phone_orders:24": 3 });
  });

  it("reads 1 for a first attempt", async () => {
    expect((await loadFacts(d1.db, rulesOf(countOf("phone_orders", 24)), submission, {}, NOW)).windowCounts).toEqual({ "phone_orders:24": 1 });
  });

  it("counts Spam Orders and every other outcome alike", async () => {
    await attempt(PHONE, IP, hoursAgo(1), "spam");
    await attempt(PHONE, IP, hoursAgo(1), "flagged");
    await attempt(PHONE, IP, hoursAgo(1), "rescued");
    expect((await loadFacts(d1.db, rulesOf(countOf("phone_orders", 24)), submission, {}, NOW)).windowCounts).toEqual({ "phone_orders:24": 4 });
  });

  it("includes the very edge of the window and nothing older", async () => {
    await attempt(PHONE, IP, hoursAgo(24));
    await attempt(PHONE, IP, new Date(Date.parse(hoursAgo(24)) - 1).toISOString());
    expect((await loadFacts(d1.db, rulesOf(countOf("phone_orders", 24)), submission, {}, NOW)).windowCounts).toEqual({ "phone_orders:24": 2 });
  });

  it("keeps each window and each key apart in one read", async () => {
    await attempt(PHONE, "9.9.9.9", hoursAgo(2));
    await attempt("0661234567", IP, hoursAgo(30));
    await attempt("0661234567", IP, hoursAgo(0.5));
    const facts = await loadFacts(d1.db, rulesOf(countOf("phone_orders", 1), countOf("phone_orders", 24), countOf("ip_orders", 1), countOf("ip_orders", 72)), submission, {}, NOW);
    expect(facts.windowCounts).toEqual({ "phone_orders:1": 1, "phone_orders:24": 2, "ip_orders:1": 2, "ip_orders:72": 3 });
  });

  it("counts two addresses of one IPv6 network together", async () => {
    await attempt(PHONE, "2001:db8:1:2::/64", hoursAgo(1));
    const facts = await loadFacts(d1.db, rulesOf(countOf("ip_orders", 24)), { ...submission, ip: "2001:db8:1:2:aaaa::1" }, {}, NOW);
    expect(facts.windowCounts).toEqual({ "ip_orders:24": 2 });
  });

  it("has no IP count without an IP", async () => {
    await attempt(PHONE, IP, hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(countOf("ip_orders", 24), countOf("phone_orders", 24)), { ...submission, ip: undefined }, {}, NOW)).windowCounts).toEqual({ "phone_orders:24": 2 });
  });

  it("uses the indexes", async () => {
    const plan = await d1.raw.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM order_attempts WHERE created_at >= ? AND (phone = ? OR ip_key = ?)").bind(NOW, PHONE, IP).all<{ detail: string }>();
    const text = plan.results.map((row) => row.detail).join(" ");
    expect(text).toContain("order_attempts_phone");
    expect(text).toContain("order_attempts_ip");
    expect(text).not.toMatch(/SCAN order_attempts\b(?! USING)/);
  });
});

describe("counting by device", () => {
  const DEVICE = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
  const onDevice = { ...submission, checkoutContext: JSON.stringify({ d: DEVICE }) };
  const byDevice = (phone: string, deviceKey: string, createdAt: string) => d1.db.insert(schema.orderAttempts).values({ id: `d${(serial += 1)}`, createdAt, phone, deviceKey, outcome: "accepted" });
  const deviceCount = (key: "device_orders" | "device_phones", windowHours: number): Condition => ({ key, op: "at_least_in_window", value: { count: 1, windowHours } });

  it("counts every order of the device, this one too", async () => {
    await byDevice(PHONE, DEVICE, hoursAgo(1));
    await byDevice("0661234567", DEVICE, hoursAgo(2));
    await byDevice(PHONE, "other", hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(deviceCount("device_orders", 24)), onDevice, {}, NOW)).windowCounts).toEqual({ "device_orders:24": 3 });
  });

  it("counts different numbers, once each, with this order's number", async () => {
    await byDevice("0661234567", DEVICE, hoursAgo(1));
    await byDevice("0661234567", DEVICE, hoursAgo(2));
    await byDevice("0771234567", DEVICE, hoursAgo(3));
    await byDevice("0550000000", "other", hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(deviceCount("device_phones", 24)), onDevice, {}, NOW)).windowCounts).toEqual({ "device_phones:24": 3 });
  });

  it("does not count this order's number twice", async () => {
    await byDevice(PHONE, DEVICE, hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(deviceCount("device_phones", 24)), onDevice, {}, NOW)).windowCounts).toEqual({ "device_phones:24": 1 });
  });

  it("leaves numbers outside the window out", async () => {
    await byDevice("0661234567", DEVICE, hoursAgo(25));
    await byDevice("0771234567", DEVICE, hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(deviceCount("device_phones", 24)), onDevice, {}, NOW)).windowCounts).toEqual({ "device_phones:24": 2 });
  });

  it("has no count at all when the browser sent no key", async () => {
    await byDevice(PHONE, DEVICE, hoursAgo(1));
    expect((await loadFacts(d1.db, rulesOf(deviceCount("device_orders", 24), deviceCount("device_phones", 24)), submission, {}, NOW)).windowCounts).toEqual({});
  });

  it("holds every kind of count in one statement, within D1's limit of bound values", async () => {
    const windows = [1, 6, 24, 72, 168, 720];
    const every = (["phone_orders", "ip_orders", "device_orders", "device_phones"] as const).flatMap((key) => windows.map((hours) => ({ key, op: "at_least_in_window", value: { count: 1, windowHours: hours } }) as Condition));
    await byDevice("0661234567", DEVICE, hoursAgo(2));
    const statements: string[] = [];
    const watched = drizzle({ prepare: (query: string) => (statements.push(query), d1.raw.prepare(query)) } as unknown as D1Database, { schema }) as unknown as AppDb;
    const facts = await loadFacts(watched, rulesOf(...every), onDevice, {}, NOW);
    expect(Object.keys(facts.windowCounts!)).toHaveLength(24);
    expect(facts.windowCounts!["device_phones:1"]).toBe(1);
    expect(facts.windowCounts!["device_phones:6"]).toBe(2);
    expect(statements).toHaveLength(1);
    expect(statements[0].match(/\?/g)!.length).toBeLessThanOrEqual(100);
  });
});

describe("what a customer did before", () => {
  async function shipment(id: string, customerId: string, milestone: "deliveredAt" | "returnedAt" | null) {
    await d1.db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId, customerName: "A", phone: PHONE, price: 1, createdAt: NOW, updatedAt: NOW });
    await d1.db.insert(schema.shipments).values({ id: `s-${id}`, orderId: id, kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 1, revision: "r", createdAt: NOW, updatedAt: NOW, ...(milestone ? { [milestone]: NOW } : {}) } as typeof schema.shipments.$inferInsert);
  }

  it("counts delivered and returned shipments for this phone only", async () => {
    await d1.db.insert(schema.drivers).values({ id: "d1", firstName: "D", lastName: "R", phone: "0770000000", createdAt: NOW, updatedAt: NOW });
    await d1.db.insert(schema.customers).values([{ id: "c1", name: "A", phone: PHONE, wilaya: "Alger", createdAt: NOW }, { id: "c2", name: "B", phone: "0661234567", wilaya: "Alger", createdAt: NOW }]);
    await shipment("o1", "c1", "deliveredAt");
    await shipment("o2", "c1", "returnedAt");
    await shipment("o3", "c1", "returnedAt");
    await shipment("o4", "c1", null);
    await shipment("o5", "c2", "deliveredAt");
    const facts = await loadFacts(d1.db, rulesOf({ key: "delivered_before", op: "at_least", value: 1 }), submission, {}, NOW);
    expect(facts.history).toEqual({ delivered: 1, returned: 2 });
  });

  it("is zero for a stranger, which is data, not missing data", async () => {
    expect((await loadFacts(d1.db, rulesOf({ key: "returned_before", op: "at_most", value: 0 }), submission, {}, NOW)).history).toEqual({ delivered: 0, returned: 0 });
  });
});

describe("the Block List", () => {
  const onList = rulesOf({ key: "phone", op: "on_block_list", value: null });

  it("finds a phone and an IP separately", async () => {
    await addToBlockList(d1.db, { kind: "phone", value: PHONE, note: null }, NOW);
    expect((await loadFacts(d1.db, onList, submission, {}, NOW)).blocked).toEqual({ phone: true, ip: false });
    await d1.db.delete(schema.orderBlockList);
    await addToBlockList(d1.db, { kind: "ip", value: IP, note: null }, NOW);
    expect((await loadFacts(d1.db, onList, submission, {}, NOW)).blocked).toEqual({ phone: false, ip: true });
  });

  it("does not mistake a phone value for an IP, or the other way round", async () => {
    await addToBlockList(d1.db, { kind: "ip", value: PHONE, note: null }, NOW);
    expect((await loadFacts(d1.db, onList, submission, {}, NOW)).blocked).toEqual({ phone: false, ip: false });
  });

  it("works with no IP", async () => {
    await addToBlockList(d1.db, { kind: "phone", value: PHONE, note: null }, NOW);
    expect((await loadFacts(d1.db, onList, { ...submission, ip: undefined }, {}, NOW)).blocked).toEqual({ phone: true, ip: false });
  });
});

describe("bursts", () => {
  const rules = rulesOf({ key: "ip_burst", op: "is_true", value: null });

  it("is a burst when the limiter says no, on a key of this store and network", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    expect((await loadFacts(d1.db, rules, submission, { limiter: { limit } }, NOW)).burst).toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: `order-attempt:s1:${IP}` });
  });

  it("is not a burst when the limiter says yes", async () => {
    expect((await loadFacts(d1.db, rules, submission, { limiter: { limit: async () => ({ success: true }) } }, NOW)).burst).toBe(false);
  });

  it("is no data without a limiter, without an IP, or when the limiter fails", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    expect(await loadFacts(d1.db, rules, submission, {}, NOW)).not.toHaveProperty("burst");
    expect(await loadFacts(d1.db, rules, { ...submission, ip: undefined }, { limiter: { limit } }, NOW)).not.toHaveProperty("burst");
    expect(limit).not.toHaveBeenCalled();
    expect(await loadFacts(d1.db, rules, submission, { limiter: { limit: async () => { throw new Error("down"); } } }, NOW)).not.toHaveProperty("burst");
  });
});

describe("only what the rules need is read", () => {
  it("touches nothing for a rule on what was typed", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const facts = await loadFacts(d1.db, rulesOf({ key: "pieces", op: "at_least", value: 1 }), submission, { limiter: { limit } }, NOW);
    expect(facts).not.toHaveProperty("windowCounts");
    expect(facts).not.toHaveProperty("history");
    expect(facts).not.toHaveProperty("blocked");
    expect(limit).not.toHaveBeenCalled();
  });

  it("leaves out an address that was not given", async () => {
    expect(await loadFacts(d1.db, [], { ...submission, address: undefined }, {}, NOW)).not.toHaveProperty("address");
  });

  it("leaves out an IP it cannot read", async () => {
    expect(await loadFacts(d1.db, [], { ...submission, ip: "garbage" }, {}, NOW)).not.toHaveProperty("ipKey");
  });
});

describe("the store's rules and settings", () => {
  const draft = { name: "R1", mode: "trial" as const, action: "flag" as const, conditions: [{ key: "pieces" as const, op: "at_least" as const, value: 2 }] };

  it("has no config until it is set, then keeps one row", async () => {
    expect(await getProtectionConfig(d1.db, "s1")).toBeUndefined();
    await setProtectionEnabled(d1.db, "s1", true, NOW);
    await setProtectionEnabled(d1.db, "s1", false, NOW);
    expect(await getProtectionConfig(d1.db, "s1")).toEqual({ enabled: false });
    expect(await d1.db.select().from(schema.storeOrderProtectionConfig)).toHaveLength(1);
  });

  it("saves, changes and deletes a rule", async () => {
    const rule = await createRule(d1.db, draft, NOW);
    expect(await getRule(d1.db, rule.id)).toMatchObject({ name: "R1", mode: "trial", action: "flag", conditions: draft.conditions, templateKey: null });
    expect(await updateRule(d1.db, rule.id, { ...draft, name: "R2", action: "spam" }, NOW)).toMatchObject({ name: "R2", action: "spam" });
    expect(await setRuleMode(d1.db, rule.id, "active", NOW)).toMatchObject({ mode: "active", name: "R2" });
    expect(await countRules(d1.db)).toBe(1);
    expect(await deleteRule(d1.db, rule.id)).toBe(true);
    expect(await deleteRule(d1.db, rule.id)).toBe(false);
    expect(await getRule(d1.db, rule.id)).toBeNull();
  });

  it("answers null for a rule that does not exist", async () => {
    expect(await updateRule(d1.db, "nope", draft, NOW)).toBeNull();
    expect(await setRuleMode(d1.db, "nope", "off", NOW)).toBeNull();
  });

  it("shows a stored rule it can no longer read, as unreadable", async () => {
    await d1.db.insert(schema.orderRules).values({ id: "bad", name: "Old", mode: "active", action: "spam", conditionsJson: "[{\"key\":\"gone\"}]", createdAt: NOW, updatedAt: NOW });
    expect(await listRules(d1.db)).toMatchObject([{ id: "bad", conditions: null }]);
  });

  it("applies a Template in place of the rules there were, and turns the App on", async () => {
    await createRule(d1.db, draft, NOW);
    await setProtectionEnabled(d1.db, "s1", false, NOW);
    await applyTemplate(d1.db, "s1", "recommended", "fr", NOW);
    const rules = await listRules(d1.db);
    expect(rules).toHaveLength(10);
    expect(rules.map((rule) => rule.name)).toEqual(templateRules("recommended", "fr").map((rule) => rule.name));
    expect(rules.every((rule) => rule.templateKey === "recommended" && rule.conditions !== null)).toBe(true);
    expect(await getProtectionConfig(d1.db, "s1")).toEqual({ enabled: true });
  });

  it("leaves no rules after Start empty, and the App on", async () => {
    await createRule(d1.db, draft, NOW);
    await applyTemplate(d1.db, "s1", "empty", "en", NOW);
    expect(await listRules(d1.db)).toEqual([]);
    expect(await getProtectionConfig(d1.db, "s1")).toEqual({ enabled: true });
  });

  it("counts each rule's matches since a moment", async () => {
    const matches = (...ids: string[]) => JSON.stringify(ids.map((ruleId) => ({ ruleId, name: "x", mode: "trial", action: "flag" })));
    await d1.db.insert(schema.orderAttempts).values([
      { id: "m1", createdAt: hoursAgo(1), phone: PHONE, outcome: "accepted", matchesJson: matches("r1", "r2") },
      { id: "m2", createdAt: hoursAgo(2), phone: PHONE, outcome: "accepted", matchesJson: matches("r1") },
      { id: "m3", createdAt: hoursAgo(50), phone: PHONE, outcome: "accepted", matchesJson: matches("r1") },
    ]);
    expect(await ruleMatchCounts(d1.db, hoursAgo(24))).toEqual({ r1: 2, r2: 1 });
  });
});

describe("the Block List's entries", () => {
  it("adds once and keeps the first note", async () => {
    const first = await addToBlockList(d1.db, { kind: "phone", value: PHONE, note: "fake" }, NOW);
    const again = await addToBlockList(d1.db, { kind: "phone", value: PHONE, note: "other" }, NOW);
    expect(again).toEqual(first);
    expect(await countBlockList(d1.db)).toBe(1);
  });

  it("filters by kind, pages and removes", async () => {
    await addToBlockList(d1.db, { kind: "phone", value: PHONE, note: null }, NOW);
    await addToBlockList(d1.db, { kind: "phone", value: "0661234567", note: null }, hoursAgo(1));
    const ip = await addToBlockList(d1.db, { kind: "ip", value: IP, note: null }, NOW);
    expect((await listBlockList(d1.db, { kind: "phone", limit: 10, offset: 0 })).total).toBe(2);
    const page = await listBlockList(d1.db, { limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 3 });
    expect(page.items).toHaveLength(1);
    expect(await removeFromBlockList(d1.db, ip.id)).toBe(true);
    expect(await removeFromBlockList(d1.db, ip.id)).toBe(false);
  });
});
