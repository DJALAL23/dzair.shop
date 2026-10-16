/**
 * Removing a product through the real route stack onto real D1, with a
 * storage bucket that records what it was asked to delete.
 *
 * Proved: what the merchant is told beforehand is what happens; a product
 * that orders hold can be removed, and those orders keep their lines; the
 * product's own records go, and nothing is left pointing at it; its image
 * files are removed only when nothing else still shows them; a storage
 * failure never undoes or blocks the removal.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import productsRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-16T10:00:00.000Z";
const KEY = (n: string) => `products/${n.repeat(32)}.webp`;
const url = (key: string) => `https://media.example.com/${key}`;

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let deletedKeys: string[] = [];
let storageFails = false;
const bucket = {
  delete: async (keys: string | string[]) => {
    if (storageFails) throw new Error("R2 unavailable");
    deletedKeys.push(...(Array.isArray(keys) ? keys : [keys]));
  },
};

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, IMAGES: bucket } as never;
    c.set("user", { id: "u1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes: ["products:read", "products:manage"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/products", productsRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  deletedKeys = [];
  storageFails = false;
  const db = d1.db;
  for (const table of [
    schema.shipments, schema.reviews, schema.orderProducts, schema.orderStatusHistory, schema.orders, schema.abandonedOrders,
    schema.landingPageImages, schema.landingPages, schema.offers, schema.stockMovements, schema.productImages,
    schema.productVariants, schema.products, schema.productCategories, schema.customers, schema.deliveryCompanies, schema.stores,
  ]) {
    await db.delete(table);
  }
  await db.insert(schema.stores).values({ id: "s1", name: "Store", logoUrl: url(KEY("c")), createdAt: T, updatedAt: T });
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await db.insert(schema.deliveryCompanies).values({ id: "co", name: "ZR", nameAr: "-", code: "zr_express", provider: "zr_express", createdAt: T, updatedAt: T });

  const product = { price: 1500, inventory: 10, trackInventory: true, createdAt: T, updatedAt: T };
  await db.insert(schema.products).values({
    ...product, id: "p1", name: "Robe", handle: "robe", sku: "ROBE", hasVariants: true,
    // An inline image of its own, and the store logo (still shown by the store).
    description: `<p><img src="${url(KEY("b"))}"><img src="${url(KEY("c"))}"></p>`,
    descriptionFormat: "html",
  });
  await db.insert(schema.products).values({ ...product, id: "p2", name: "Foulard", handle: "foulard", sku: "FOU", description: `<img src="${url(KEY("d"))}">`, descriptionFormat: "html" });
  await db.insert(schema.productVariants).values({ id: "v1", productId: "p1", variations: "{}", price: 1500, sku: "ROBE-M", inventory: 4, createdAt: T, updatedAt: T });
  await db.insert(schema.productImages).values([
    { id: "i1", productId: "p1", src: url(KEY("a")), r2Key: KEY("a"), createdAt: T, updatedAt: T },
    // The same file as p2's description: it must stay.
    { id: "i2", productId: "p1", src: url(KEY("d")), r2Key: KEY("d"), position: 2, createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.offers).values({ id: "of1", name: "Gift", triggerProductId: "p2", rewardProductId: "p1", createdAt: T, updatedAt: T });
  await db.insert(schema.landingPages).values([
    { id: "lp1", slug: "robe-ete", name: "Robe été", productId: "p1", createdAt: T, updatedAt: T },
    // A duplicate of lp1 for another product shares its image file.
    { id: "lp2", slug: "foulard-ete", name: "Foulard été", productId: "p2", createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.landingPageImages).values([
    { id: "li1", landingPageId: "lp1", r2Key: "landing/own.webp", src: "https://media.example.com/landing/own.webp", createdAt: T },
    { id: "li2", landingPageId: "lp1", r2Key: "landing/shared.webp", src: "https://media.example.com/landing/shared.webp", createdAt: T },
    { id: "li3", landingPageId: "lp2", r2Key: "landing/shared.webp", src: "https://media.example.com/landing/shared.webp", createdAt: T },
  ]);

  const order = { customerId: "c1", customerName: "Karim", phone: "0551234567", price: 1500, createdAt: T, updatedAt: T };
  // Delivered, from the landing page; and one still to ship.
  await db.insert(schema.orders).values({ ...order, id: "oDone", orderNumber: "ORD-1", status: "ready", landingPageId: "lp1" });
  await db.insert(schema.orders).values({ ...order, id: "oOpen", orderNumber: "ORD-2", status: "confirmed" });
  await db.insert(schema.orderProducts).values([
    { id: "l1", orderId: "oDone", productId: "p1", productName: "Robe", variantId: "v1", variantLabel: "M", sku: "ROBE-M", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T },
    { id: "l2", orderId: "oOpen", productId: "p1", productName: "Robe", variantId: "v1", variantLabel: "M", sku: "ROBE-M", quantity: 2, pricePerUnit: 1500, lineTotal: 3000, createdAt: T },
  ]);
  await db.insert(schema.shipments).values({
    id: "sh", orderId: "oDone", kind: "carrier", companyId: "co", handoffState: "accepted", carrierParcelId: "P-1", deliveryType: "home",
    codAmount: 1900, revision: 1, deliveredAt: T, createdAt: T, updatedAt: T,
  } as never);
  await db.insert(schema.reviews).values({ id: "r1", storeId: "s1", productId: "p1", orderId: "oDone", orderNumber: "ORD-1", customerName: "Karim", rating: 5, body: "Top", createdAt: T, updatedAt: T });
  await db.insert(schema.abandonedOrders).values({ id: "ab", sessionId: "s", customerName: "Lina", phone: "0661234567", productId: "p1", productName: "Robe", variantId: "v1", createdAt: T, updatedAt: T });
});

const request = (method: string, path: string) => app.request(`/api/products${path}`, { method });
const rows = <T extends Parameters<typeof d1.db.select>[0]>(fields: T) => d1.db.select(fields);

describe("what removing a product does", () => {
  it("is said beforehand: what goes, and what stays", async () => {
    const res = await request("GET", "/p1/removal");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({
      id: "p1", name: "Robe", variants: 1, images: 2, reviews: 1, offers: 1, landingPages: 1, landingPageOrders: 1, orderLines: 2, ordersToShip: 1,
    });
    expect((await request("GET", "/nope/removal")).status).toBe(404);
  });

  it("removes a product that orders hold; the orders keep their lines, as sold", async () => {
    const res = await request("DELETE", "/p1");
    expect(res.status).toBe(200);

    expect(await d1.db.select({ id: schema.orderProducts.id, productId: schema.orderProducts.productId, variantId: schema.orderProducts.variantId, productName: schema.orderProducts.productName, sku: schema.orderProducts.sku, lineTotal: schema.orderProducts.lineTotal }).from(schema.orderProducts).orderBy(schema.orderProducts.id).all()).toEqual([
      { id: "l1", productId: null, variantId: null, productName: "Robe", sku: "ROBE-M", lineTotal: 1500 },
      { id: "l2", productId: null, variantId: null, productName: "Robe", sku: "ROBE-M", lineTotal: 3000 },
    ]);
    expect((await d1.db.select().from(schema.orders).all()).map((o) => [o.id, o.landingPageId])).toEqual([["oDone", null], ["oOpen", null]]);
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(1);
    expect(await d1.db.select({ productId: schema.abandonedOrders.productId, productName: schema.abandonedOrders.productName }).from(schema.abandonedOrders).all()).toEqual([{ productId: null, productName: "Robe" }]);
  });

  it("takes everything that was its own, and leaves nothing pointing at it", async () => {
    await request("DELETE", "/p1");
    for (const [name, table, column] of [
      ["variants", schema.productVariants, schema.productVariants.productId],
      ["images", schema.productImages, schema.productImages.productId],
      ["reviews", schema.reviews, schema.reviews.productId],
      ["stock movements", schema.stockMovements, schema.stockMovements.productId],
      ["landing pages", schema.landingPages, schema.landingPages.productId],
    ] as const) {
      expect(await d1.db.select().from(table).where(eq(column, "p1")).all(), name).toEqual([]);
    }
    expect(await d1.db.select().from(schema.offers).all()).toEqual([]);
    expect(await d1.db.select({ id: schema.landingPageImages.id }).from(schema.landingPageImages).all()).toEqual([{ id: "li3" }]);
    expect((await d1.raw.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await d1.db.select().from(schema.products).all()).map((p) => p.id)).toEqual(["p2"]);
  });

  it("frees its handle and SKU at once", async () => {
    await request("DELETE", "/p1");
    await d1.db.insert(schema.products).values({ id: "p3", name: "Robe 2", handle: "robe", sku: "ROBE", price: 1, createdAt: T, updatedAt: T });
    expect((await d1.db.select().from(schema.products).where(eq(schema.products.id, "p3")).get())?.handle).toBe("robe");
  });

  it("deletes only the image files nothing else still shows", async () => {
    await request("DELETE", "/p1");
    expect(deletedKeys.sort()).toEqual([KEY("a"), KEY("b"), "landing/own.webp"].sort());
  });

  it("a storage failure leaves the files for the sweep; the product is still removed", async () => {
    storageFails = true;
    expect((await request("DELETE", "/p1")).status).toBe(200);
    expect(await d1.db.select().from(schema.products).where(eq(schema.products.id, "p1")).all()).toEqual([]);
  });

  it("an unknown product is not found", async () => {
    expect((await request("DELETE", "/nope")).status).toBe(404);
    expect(deletedKeys).toEqual([]);
  });
});

void rows;
