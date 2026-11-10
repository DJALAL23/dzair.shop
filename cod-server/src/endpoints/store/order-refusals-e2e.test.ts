/**
 * A refused storefront order says which line it refused, on real D1: the
 * storefront words the refusal in the shopper's language from that line, and
 * a refused order writes nothing.
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
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-11-10T08:00:00.000Z";
const STORE = "store-refusals";

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

const product = (id: string, extra: Partial<typeof schema.products.$inferInsert> = {}) => ({ id, name: `Nom ${id}`, handle: id, price: 3000, sku: `SKU-${id}`, status: "ACTIVE" as const, trackInventory: true, inventory: 50, createdAt: T, updatedAt: T, ...extra });
const variant = (id: string, productId: string, extra: Partial<typeof schema.productVariants.$inferInsert> = {}) => ({ id, productId, variations: JSON.stringify({ Couleur: id }), price: 3000, sku: `SKU-${id}`, inventory: 10, createdAt: T, updatedAt: T, ...extra });

beforeEach(async () => {
  for (const table of ["business_events", "order_products", "stock_movements", "orders", "customers", "product_variants", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  for (const row of [
    product("robe", { hasVariants: true }),
    product("sac"),
    product("brouillon", { status: "DRAFT" }),
    product("invisible", { visibility: false }),
    product("cache", { showInStore: false }),
    product("sans-sku", { sku: null }),
    product("rare", { inventory: 1 }),
  ]) await d1.db.insert(schema.products).values(row);
  for (const row of [variant("robe-rouge", "robe"), variant("robe-bleue", "robe", { inventory: 1 }), variant("robe-off", "robe", { active: false })]) {
    await d1.db.insert(schema.productVariants).values(row);
  }
});

async function order(items: { productId: string; variantId?: string; quantity: number }[]) {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone: "0662222222", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "12 Rue Didouche", items: items.map((line) => ({ ...line, productName: line.productId })) }),
  });
  return { status: response.status, json: (await response.json()) as any };
}

const count = async (table: string) => (await d1.db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0].n;
const inventoryOf = async (id: string) => (await d1.db.select({ inventory: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, id)).get())!.inventory;

/** A refusal leaves the store as it was: no order, no customer, no stock moved. */
async function expectNothingWritten() {
  expect(await count("orders")).toBe(0);
  expect(await count("customers")).toBe(0);
  expect(await count("stock_movements")).toBe(0);
  expect(await inventoryOf("sac")).toBe(50);
}

describe("an order for what is not in stock", () => {
  it("names the product that is short", async () => {
    const refused = await order([{ productId: "sac", quantity: 1 }, { productId: "rare", quantity: 2 }]);
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: ERROR_CODES.INSUFFICIENT_STOCK, context: { productId: "rare" } });
    expect(refused.json.context).not.toHaveProperty("variantId");
    await expectNothingWritten();
  });

  it("names the option that is short", async () => {
    const refused = await order([{ productId: "robe", variantId: "robe-bleue", quantity: 2 }]);
    expect(refused.json).toMatchObject({ code: ERROR_CODES.INSUFFICIENT_STOCK, context: { productId: "robe", variantId: "robe-bleue" } });
  });
});

describe("an order for what can no longer be ordered", () => {
  it.each([
    ["a draft", "brouillon"],
    ["an invisible product", "invisible"],
    ["a product the store does not have", "inconnu"],
  ])("refuses %s, naming it", async (_, productId) => {
    const refused = await order([{ productId: "sac", quantity: 1 }, { productId, quantity: 1 }]);
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: ERROR_CODES.PRODUCT_NOT_FOUND, context: { productId } });
    await expectNothingWritten();
  });

  it("refuses an option turned off, or one of another product, naming it", async () => {
    expect((await order([{ productId: "robe", variantId: "robe-off", quantity: 1 }])).json).toMatchObject({ code: ERROR_CODES.VARIANT_NOT_FOUND, context: { productId: "robe", variantId: "robe-off" } });
    expect((await order([{ productId: "sac", variantId: "robe-rouge", quantity: 1 }])).json).toMatchObject({ code: ERROR_CODES.VARIANT_NOT_FOUND, context: { productId: "sac", variantId: "robe-rouge" } });
    await expectNothingWritten();
  });

  it("still sells a product hidden from the store: its landing page sells it", async () => {
    const placed = await order([{ productId: "cache", quantity: 1 }]);
    expect(placed.status).toBe(201);
    expect(await inventoryOf("cache")).toBe(49);
  });

  it("still sells an active option of an active product", async () => {
    expect((await order([{ productId: "robe", variantId: "robe-rouge", quantity: 1 }])).status).toBe(201);
  });

  it("asks for a SKU only on a product that can be ordered", async () => {
    const refused = await order([{ productId: "sans-sku", quantity: 1 }]);
    expect(refused.json).toMatchObject({ code: ERROR_CODES.REQUIRED_FIELD_MISSING, context: { productId: "sans-sku" } });
  });
});
