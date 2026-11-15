/**
 * The Meta cookies a storefront order carries, on real D1: a well-formed
 * `_fbc` / `_fbp` is kept on the order for the Conversions API, and a
 * malformed one is dropped while the order is taken all the same.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-10-01T00:00:00.000Z";
const STORE = "store-meta-cookies";

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("storeId", STORE);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "order_products", "stock_movements", "orders", "customers", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "ROBE", status: "ACTIVE", trackInventory: true, inventory: 10, createdAt: T, updatedAt: T });
});

async function checkout(cookies: Record<string, unknown>) {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "robe", productName: "Robe", quantity: 1 }], ...cookies }),
  });
  expect(response.status).toBe(201);
  const { data } = (await response.json()) as { data: { orderId: string } };
  return d1.db.select({ fbc: schema.orders.fbc, fbp: schema.orders.fbp }).from(schema.orders).where(eq(schema.orders.id, data.orderId)).get();
}

describe("a storefront order's Meta cookies", () => {
  it("are kept when well formed", async () => {
    expect(await checkout({ fbc: "fb.1.1709136167115.IwAR2F4-dbP0l7Mn1.ABcDEFGh", fbp: "fb.1.1596403881668.1116446470" })).toEqual({
      fbc: "fb.1.1709136167115.IwAR2F4-dbP0l7Mn1.ABcDEFGh",
      fbp: "fb.1.1596403881668.1116446470",
    });
  });

  it("are dropped when malformed, and the order is taken all the same", async () => {
    expect(await checkout({ fbc: "IwAR2F4-dbP0l7Mn1", fbp: "fb.1.1596403881.1116446470" })).toEqual({ fbc: null, fbp: null });
  });
});
