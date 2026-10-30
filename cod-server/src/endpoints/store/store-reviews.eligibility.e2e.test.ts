/**
 * Who may review, on real D1 (`findReviewableOrder`): the order number and
 * the phone it was placed with, the order delivered, and only the products
 * the shopper kept — each once.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { findReviewableOrder } from "../../../../cod-shared/queries/store-reviews";

let d1: TestD1;
const T = "2026-10-16T10:00:00.000Z";
const T2 = "2026-10-16T10:00:01.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
  const seed = [
    "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Store', ?1, ?1)",
    "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)",
    "INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'ZR', 'ZR', 'zr_express', 'zr_express', ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1500, ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p2', 'Foulard', 'foulard', 500, ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p3', 'Sac', 'sac', 3000, ?1, ?1)",
    "INSERT INTO product_images (id, product_id, media_key, position, created_at, updated_at) VALUES ('i2', 'p1', 'products/robe-2.webp', 2, ?1, ?1)",
    "INSERT INTO product_images (id, product_id, media_key, position, created_at, updated_at) VALUES ('i1', 'p1', 'products/robe-1.webp', 1, ?1, ?1)",
    // Delivered: a robe (two lines of it), a scarf, and a bag refused in full at the door.
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, created_at, updated_at) VALUES ('oD', 'ORD-20261016-1234', 'c1', 'Karim', '0551 23 45 67', 6500, 'ready', ?1, ?1)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l1', 'oD', 'p1', 'Robe', 1, 1500, 1500, ?1)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l2', 'oD', 'p2', 'Foulard', 1, 500, 500, ?2)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, returned_quantity, status, created_at) VALUES ('l3', 'oD', 'p3', 'Sac', 1, 3000, 3000, 1, 'returned', ?2)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, returned_quantity, status, created_at) VALUES ('l4', 'oD', 'p1', 'Robe', 2, 1500, 3000, 2, 'returned', ?2)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l5', 'oD', NULL, 'Ceinture (retirée)', 1, 500, 500, ?2)",
    "INSERT INTO shipments (id, order_id, kind, company_id, handoff_state, carrier_parcel_id, delivery_type, cod_amount, revision, delivered_at, created_at, updated_at) VALUES ('shD', 'oD', 'carrier', 'co1', 'accepted', 'P-1', 'home', 6500, 1, ?1, ?1, ?1)",
    "INSERT INTO reviews (id, store_id, product_id, order_id, order_number, customer_name, rating, body, created_at, updated_at) VALUES ('r1', 's1', 'p2', 'oD', 'ORD-20261016-1234', 'Karim', 5, 'Joli foulard', ?1, ?1)",
    // On its way; and never shipped.
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, created_at, updated_at) VALUES ('oT', 'ORD-20261016-5555', 'c1', 'Karim', '0551234567', 1500, 'ready', ?1, ?1)",
    "INSERT INTO shipments (id, order_id, kind, company_id, handoff_state, carrier_parcel_id, delivery_type, cod_amount, revision, created_at, updated_at) VALUES ('shT', 'oT', 'carrier', 'co1', 'accepted', 'P-2', 'home', 1500, 1, ?1, ?1)",
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('oN', 'ORD-20261016-7777', 'c1', 'Karim', '0551234567', 1500, ?1, ?1)",
  ];
  for (const sql of seed) await d1.raw.prepare(sql).bind(...(sql.includes("?2") ? [T, T2] : [T])).run();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const find = (orderNumber: string, phone: string) => findReviewableOrder(d1.db, { orderNumber, phone });

describe("who may review", () => {
  it("the shopper of a delivered order, with its number and phone, however they type them", async () => {
    const access = await find(" ord-20261016-1234 ", "+213551234567");
    expect(access).toEqual({
      ok: true,
      order: {
        id: "oD", orderNumber: "ORD-20261016-1234", customerId: "c1", customerName: "Karim",
        products: [
          { productId: "p1", name: "Robe", imageKey: "products/robe-1.webp", reviewed: false },
          { productId: "p2", name: "Foulard", imageKey: null, reviewed: true },
        ],
      },
    });
  });

  it("leaves out what was refused at the door, and what is no longer in the catalog", async () => {
    const access = await find("ORD-20261016-1234", "0551234567");
    expect(access.ok && access.order.products.map((p) => p.productId)).toEqual(["p1", "p2"]);
  });

  it("answers a wrong phone exactly as an unknown order", async () => {
    expect(await find("ORD-20261016-1234", "0661234567")).toEqual({ ok: false, reason: "not_found" });
    expect(await find("ORD-20261016-0000", "0551234567")).toEqual({ ok: false, reason: "not_found" });
    expect(await find("ORD-20261016-1234", "")).toEqual({ ok: false, reason: "not_found" });
  });

  it("waits until the order reached the shopper", async () => {
    expect(await find("ORD-20261016-5555", "0551234567")).toEqual({ ok: false, reason: "not_delivered" });
    expect(await find("ORD-20261016-7777", "0551234567")).toEqual({ ok: false, reason: "not_delivered" });
  });

  it("does not say an order is undelivered to someone with the wrong phone", async () => {
    expect(await find("ORD-20261016-5555", "0771234567")).toEqual({ ok: false, reason: "not_found" });
  });
});
