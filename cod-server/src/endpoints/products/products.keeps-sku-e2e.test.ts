/**
 * A product the merchant edits stays orderable: one without options orders by
 * its own SKU, so an edit that would leave it with neither options nor a SKU
 * is refused on the SKU field, and once it has one, the store takes its order.
 * Real D1, the products API and the storefront's order endpoint together.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";

const STORE_ID = "store-1";
const T = "2026-11-10T08:00:00.000Z";

const WORKER = `
import { OpenAPIHono } from "@hono/zod-openapi";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import productsRouter from "./routes";
import storeRoutes from "../store/routes";

const app = new OpenAPIHono({ defaultHook: openApiValidationHook });
app.use("*", async (c, next) => {
  c.set("storeId", "${STORE_ID}");
  c.set("user", { id: "admin", role: "admin", status: "active", scopes: [] });
  await next();
});
app.onError(errorHandler);
app.route("/store", storeRoutes);
app.route("/api/products", productsRouter);
export default app;
`;

let harness: TestD1;

const request = async (path: string, init?: { method: string; body: unknown }) => {
  const res = await harness.fetch(`http://test${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};

const edit = (id: string, body: Record<string, unknown>) => request(`/api/products/${id}`, { method: "PATCH", body });
const order = (productId: string) =>
  request("/store/orders", {
    method: "POST",
    body: { customerName: "Amel Kaci", phone: "0662222222", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "12 Rue Didouche", items: [{ productId, productName: productId, quantity: 1 }] },
  });
const productRow = (id: string) => harness.db.select({ hasVariants: schema.products.hasVariants, sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, id)).get();

const product = (id: string, extra: Partial<typeof schema.products.$inferInsert>) => ({ id, name: id, handle: id, price: 3000, status: "ACTIVE" as const, trackInventory: false, inventory: 0, createdAt: T, updatedAt: T, ...extra });

beforeAll(async () => {
  harness = await createTestD1({ worker: await bundleWorker(WORKER, __dirname) });
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  for (const table of ["business_events", "order_products", "stock_movements", "orders", "customers", "product_variants", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await harness.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await harness.db.insert(schema.stores).values({ id: STORE_ID, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await harness.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await harness.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  // As the starter seeds a product with options: the SKUs are on the options, none on the product.
  await harness.db.insert(schema.products).values(product("baskets", { hasVariants: true, sku: null }));
  await harness.db.insert(schema.productVariants).values({ id: "baskets-40", productId: "baskets", variations: JSON.stringify({ Pointure: "40" }), price: 3000, sku: "BASKETS-40", inventory: 5, createdAt: T, updatedAt: T });
  await harness.db.insert(schema.products).values(product("gourde", { sku: "GOURDE" }));
});

describe("a product edited in the dashboard", () => {
  it("cannot have its options turned off without a SKU, and is told so on the SKU field", async () => {
    const refused = await edit("baskets", { hasVariants: false });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "VALIDATION_FAILED", context: { fields: [{ path: "sku" }] } });
    expect(await productRow("baskets")).toEqual({ hasVariants: true, sku: null });
  });

  it("is ordered once its options are turned off with a SKU", async () => {
    expect((await edit("baskets", { hasVariants: false, sku: "BASKETS" })).status).toBe(200);
    const placed = await order("baskets");
    expect(placed.status).toBe(201);
  });

  it("keeps its SKU through any other edit, Track inventory included", async () => {
    expect((await edit("gourde", { name: "Gourde isotherme", trackInventory: false })).status).toBe(200);
    expect((await order("gourde")).status).toBe(201);
  });

  it("refuses an edit that leaves a product without options and without a SKU, until it gets one", async () => {
    await harness.db.update(schema.products).set({ hasVariants: false }).where(eq(schema.products.id, "baskets"));
    expect((await order("baskets")).body.code).toBe("REQUIRED_FIELD_MISSING");
    expect((await edit("baskets", { name: "Baskets blanches" })).status).toBe(400);
    expect((await edit("baskets", { sku: "BASKETS" })).status).toBe(200);
    expect((await order("baskets")).status).toBe(201);
  });
});
