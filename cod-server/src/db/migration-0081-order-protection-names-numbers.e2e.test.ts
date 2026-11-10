import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-09T08:00:00.000Z";

const rule = (id: string, name: string, templateKey: string | null) =>
  d1.raw.prepare(`INSERT INTO order_rules (id, name, mode, action, conditions_json, template_key, created_at, updated_at) VALUES (?, ?, 'trial', 'flag', '[]', ?, ?, ?)`).bind(id, name, templateKey, T, T).run();

const order = (id: string, orderNumber: string) =>
  d1.raw.prepare(`INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES (?, ?, 'c1', 'A', '0551234567', 1, ?, ?)`).bind(id, orderNumber, T, T).run();

const attempt = (id: string, outcome: string, orderNumber: string) =>
  d1.raw.prepare(`INSERT INTO order_attempts (id, created_at, phone, outcome, order_number) VALUES (?, ?, '0551234567', ?, ?)`).bind(id, T, outcome, orderNumber).run();

beforeAll(async () => {
  d1 = await createTestD1({ before: "0081_order_protection_names_numbers.sql" });
  await rule("en", "Customers who received an order", "recommended");
  await rule("fr", "Plusieurs commandes d'un même numéro", "recommended");
  await rule("ar", "مرتجعات دون أي تسليم", "under_attack");
  await rule("renamed", "Mes bons clients", "recommended");
  await rule("own", "Customers who received an order", null);
  await d1.applyRemaining();
  await d1.raw.prepare(`INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'A', '0551234567', 'Alger', ?)`).bind(T).run();
}, 120_000);

afterAll(async () => d1?.dispose());

const templateRules = async () =>
  Object.fromEntries((await d1.raw.prepare(`SELECT id, name, template_rule FROM order_rules ORDER BY id`).all<{ id: string; name: string; template_rule: string | null }>()).results.map((row) => [row.id, [row.name, row.template_rule]]));

describe("0081 Order Protection names and numbers", () => {
  it("tells each template rule, in any language, which one it is, and keeps every name", async () => {
    expect(await templateRules()).toEqual({
      en: ["Customers who received an order", "good_customer"],
      fr: ["Plusieurs commandes d'un même numéro", "same_phone"],
      ar: ["مرتجعات دون أي تسليم", "returner"],
      renamed: ["Mes bons clients", null],
      own: ["Customers who received an order", null],
    });
  });

  it("refuses an order the number a Spam Order holds, as a taken number", async () => {
    await attempt("held", "spam", "ORD-20261109-1111");
    await expect(order("o1", "ORD-20261109-1111")).rejects.toThrow(/UNIQUE constraint failed: orders\.order_number/);
    await order("o2", "ORD-20261109-2222");
    await expect(d1.raw.prepare(`UPDATE orders SET order_number = 'ORD-20261109-1111' WHERE id = 'o2'`).run()).rejects.toThrow(/UNIQUE constraint failed: orders\.order_number/);
  });

  it("lets a rescued Spam Order, or any other attempt, give its number to an order", async () => {
    await attempt("rescued", "rescued", "ORD-20261109-3333");
    await order("o3", "ORD-20261109-3333");
    await attempt("seen", "accepted", "ORD-20261109-4444");
    await order("o4", "ORD-20261109-4444");
    await d1.raw.prepare(`UPDATE orders SET customer_name = 'B' WHERE id = 'o2'`).run();
  });
});
