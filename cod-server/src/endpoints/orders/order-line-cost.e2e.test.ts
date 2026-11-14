/**
 * What each order line cost the merchant, through the real writers on real D1
 * (marketing analytics Phase 2.1): a dashboard order and a storefront checkout
 * both freeze each line's unit cost when the order is written — the
 * variant's own cost, else the product's — and a later change to the catalog
 * leaves the order as it was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { staff } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { createOrder } from "../../../../cod-shared/queries/orders";
import storeRouter from "../store/routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-11-14T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("storeId", "store-cost");
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "order_attribution", "order_products", "stock_movements", "orders", "customers", "product_variants", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: "store-cost", name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, costPrice: 1200, hasVariants: true, status: "ACTIVE", visibility: true, showInStore: true, trackInventory: true, inventory: 0, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.productVariants).values([
    { id: "robe-s", productId: "robe", variations: '{"Taille":"S"}', price: 3000, sku: "ROBE-S", inventory: 10, active: true, createdAt: T, updatedAt: T },
    { id: "robe-m", productId: "robe", variations: '{"Taille":"M"}', price: 3000, costPrice: 1500, sku: "ROBE-M", inventory: 10, active: true, createdAt: T, updatedAt: T },
  ]);
});

const costs = async (orderId: string) =>
  (
    await d1.db
      .select({ variantId: schema.orderProducts.variantId, unitCost: schema.orderProducts.unitCost, source: schema.orderProducts.unitCostSource })
      .from(schema.orderProducts)
      .where(eq(schema.orderProducts.orderId, orderId))
  ).sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)));

const FROZEN = [
  { variantId: "robe-m", unitCost: 1500, source: "catalog" },
  { variantId: "robe-s", unitCost: 1200, source: "catalog" },
];

describe("an order freezes what each line cost", () => {
  it("in a dashboard order", async () => {
    await createOrder(
      d1.db,
      { id: "o-dash", orderNumber: "ORD-DASH", customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1", price: 6000, deliveryFee: 600, codAmount: 6600, createdAt: T, updatedAt: T },
      [
        { id: "o-dash-1", orderId: "o-dash", productId: "robe", productName: "Robe", variantId: "robe-s", quantity: 1, pricePerUnit: 3000, lineTotal: 3000, createdAt: T },
        { id: "o-dash-2", orderId: "o-dash", productId: "robe", productName: "Robe", variantId: "robe-m", quantity: 1, pricePerUnit: 3000, lineTotal: 3000, createdAt: T },
      ],
      staff("u-samira", "Samira"),
    );
    expect(await costs("o-dash")).toEqual(FROZEN);
  });

  it("in a storefront checkout, and keeps it when the catalog's cost changes", async () => {
    const response = await app.request("/store/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Amel Kaci",
        phone: "0551234567",
        wilayaId: 16,
        communeId: "c-16-001",
        deliveryType: "home",
        address: "Rue 1",
        items: [
          { productId: "robe", variantId: "robe-s", productName: "Robe", quantity: 1 },
          { productId: "robe", variantId: "robe-m", productName: "Robe", quantity: 1 },
        ],
      }),
    });
    expect(response.status).toBeLessThan(300);
    const order = await d1.db.select({ id: schema.orders.id }).from(schema.orders).get();
    expect(await costs(order!.id)).toEqual(FROZEN);

    await d1.db.update(schema.products).set({ costPrice: 1900 });
    await d1.db.update(schema.productVariants).set({ costPrice: 2100 });
    expect(await costs(order!.id)).toEqual(FROZEN);
  });
});
