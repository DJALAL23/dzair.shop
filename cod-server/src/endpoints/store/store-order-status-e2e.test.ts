/**
 * POST /store/orders/status on real D1: a shopper proves an order is theirs
 * with its number and phone, and reads where it is in their own words — never
 * the address, the notes or the merchant's statuses. A wrong number and a
 * wrong phone answer the same, and attempts are limited per order and per
 * shopper.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import storeRouter from "./routes";

let d1: TestD1;
vi.mock("@/db", () => ({ getDb: () => d1.db }));

const T = "2026-10-23T09:00:00.000Z";
const T2 = "2026-10-23T09:00:01.000Z";

/** order id, number, status, and the shipment it has: kind, handoff, tracking, milestones. */
const ORDERS: [string, string, string, string | null][] = [
  ["o-confirmed", "ORD-20261023-0001", "confirmed", null],
  ["o-unreachable", "ORD-20261023-0002", "unreachable", null],
  // A tracking number before the carrier accepted the parcel, or on the store's own driver, is not the shopper's to follow.
  ["o-pending", "ORD-20261023-0003", "ready", "'carrier', 'submitting', 'YAL-000000', NULL, NULL"],
  ["o-transit", "ORD-20261023-0004", "ready", "'carrier', 'accepted', 'YAL-778899', NULL, NULL"],
  ["o-delivered", "ORD-20261023-0005", "ready", "'carrier', 'accepted', 'YAL-112233', ?1, NULL"],
  ["o-driver", "ORD-20261023-0006", "ready", "'driver', 'accepted', 'DRV-1', NULL, NULL"],
  ["o-cancelled", "ORD-20261023-0007", "cancelled", null],
  ["o-carrier-cancelled", "ORD-20261023-0008", "ready", "'carrier', 'accepted', 'YAL-445566', NULL, ?1"],
];

beforeAll(async () => {
  d1 = await createTestD1();
  const seed = [
    "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Bébé', ?1, ?1)",
    "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amina', '0551234567', 'Alger', ?1)",
    "INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'Yalidine', 'ياليدين', 'yalidine', 'yalidine', ?1, ?1)",
    "INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Sofiane', 'B', '0661111111', ?1, ?1)",
  ];
  for (const [id, number, status, shipment] of ORDERS) {
    seed.push(
      `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, address, notes, price, delivery_fee, cod_amount, delivery_type, status, created_at, updated_at) VALUES ('${id}', '${number}', 'c1', 'Amina', '0551 23 45 67', '12 rue secrète', 'Appeler après 18h', 3000, 400, 3400, 'home', '${status}', ?1, ?1)`,
      `INSERT INTO order_products (id, order_id, product_name, variant_label, quantity, price_per_unit, line_total, created_at) VALUES ('${id}-l2', '${id}', 'Robe en coton', '6 mois', 2, 1200, 2400, ?1)`,
      `INSERT INTO order_products (id, order_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('${id}-l1', '${id}', 'Bavoir', 1, 600, 600, ?2)`,
    );
    if (shipment) {
      const [kind] = shipment.split(",");
      const owner = kind!.includes("driver") ? "NULL, 'd1', NULL" : `'co1', NULL, 'P-${id}'`;
      seed.push(
        `INSERT INTO shipments (id, order_id, kind, handoff_state, tracking_number, delivered_at, cancelled_at, company_id, driver_id, carrier_parcel_id, delivery_type, cod_amount, revision, created_at, updated_at) VALUES ('${id}-sh', '${id}', ${shipment}, ${owner}, 'home', 3400, 1, ?1, ?1)`,
      );
    }
  }
  for (const sql of seed) await d1.raw.prepare(sql).bind(...(sql.includes("?2") ? [T, T2] : [T])).run();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

let limiter: { limit: (input: { key: string }) => Promise<{ success: boolean }> } | undefined;

function app() {
  const router = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  router.use("*", async (c, next) => {
    c.env = { DB: {}, REVIEW_RATE_LIMITER: limiter } as never;
    c.set("storeId", "s1");
    await next();
  });
  router.onError(errorHandler);
  router.route("/store", storeRouter);
  return router;
}

async function lookUp(body: unknown, headers: Record<string, string> = {}) {
  const response = await app().request("/store/orders/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const LINES = [
  { name: "Robe en coton", variantLabel: "6 mois", quantity: 2 },
  { name: "Bavoir", variantLabel: null, quantity: 1 },
];

describe("POST /store/orders/status", () => {
  it("answers the shopper's order with its number and phone, however they type them, and nothing private", async () => {
    const { status, body } = await lookUp({ orderNumber: " ord-20261023-0001 ", phone: "+213551234567" });
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { orderNumber: "ORD-20261023-0001", placedAt: T, stage: "confirmed", deliveryType: "home", lines: LINES, total: 3400, tracking: null },
    });
    const text = JSON.stringify(body);
    for (const secret of ["rue secrète", "Appeler", "0551", "Amina", "c1", "o-confirmed"]) expect(text).not.toContain(secret);
  });

  it.each([
    ["ORD-20261023-0002", "placed", null],
    ["ORD-20261023-0003", "preparing", null],
    ["ORD-20261023-0004", "shipped", { number: "YAL-778899", carrier: "Yalidine" }],
    ["ORD-20261023-0005", "delivered", { number: "YAL-112233", carrier: "Yalidine" }],
    ["ORD-20261023-0006", "shipped", null],
    ["ORD-20261023-0007", "cancelled", null],
    ["ORD-20261023-0008", "preparing", { number: "YAL-445566", carrier: "Yalidine" }],
  ])("%s reads as %s", async (orderNumber, stage, tracking) => {
    const { status, body } = await lookUp({ orderNumber, phone: "0551234567" });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ stage, tracking });
  });

  it("answers a wrong phone exactly as an unknown order", async () => {
    const wrongPhone = await lookUp({ orderNumber: "ORD-20261023-0001", phone: "0661234567" });
    const unknown = await lookUp({ orderNumber: "ORD-20261023-9999", phone: "0551234567" });
    expect(wrongPhone.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrongPhone.body.code).toBe("ORDER_NOT_FOUND");
    expect(wrongPhone.body).toEqual(unknown.body);
  });

  it("refuses what is not an order number or a phone", async () => {
    for (const body of [{ orderNumber: "42", phone: "0551234567" }, { orderNumber: "ORD-20261023-0001", phone: "05" }, { orderNumber: "ORD-20261023-0001" }]) {
      const answer = await lookUp(body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body.code).toBe("VALIDATION_FAILED");
    }
  });

  it("limits attempts per order and per shopper", async () => {
    const asked: string[] = [];
    limiter = { limit: async ({ key }) => (asked.push(key), { success: !key.startsWith("order-status-ip:") }) };
    try {
      const refused = await lookUp({ orderNumber: "ord-20261023-0001", phone: "0551234567" }, { "X-Forwarded-For": "41.100.1.2, 10.0.0.1" });
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: "ORDER_LOOKUP_RATE_LIMITED", context: { windowSeconds: 60 } });
      expect(asked).toEqual(["order-status:ORD-20261023-0001", "order-status-ip:41.100.1.2"]);

      limiter = { limit: async () => ({ success: false }) };
      expect((await lookUp({ orderNumber: "ORD-20261023-0001", phone: "0551234567" })).body.code).toBe("ORDER_LOOKUP_RATE_LIMITED");

      limiter = { limit: async () => Promise.reject(new Error("limiter down")) };
      expect((await lookUp({ orderNumber: "ORD-20261023-0001", phone: "0551234567" })).status).toBe(200);
    } finally {
      limiter = undefined;
    }
  });
});
