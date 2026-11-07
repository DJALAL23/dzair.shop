/**
 * The language an order was placed in (migration 0063), per Origin, on real
 * D1: a storefront checkout records the language the shopper was served, a
 * dashboard or agent order the store's primary, and an order placed before
 * either was recorded keeps none — never a guessed one. Its Business Events
 * carry it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { eventsOf } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { createOrder, updateOrderStatus } from "../../../../cod-shared/queries/orders";
import storeRouter from "./routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-10-01T00:00:00.000Z";
const STORE = "store-langs";

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
  for (const table of ["business_events", "order_products", "order_status_history", "stock_movements", "orders", "customers", "products", "shipping_rules", "shipping_profiles", "store_locales", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.storeLocales).values([
    { storeId: STORE, locale: "ar", published: true, createdAt: T },
    { storeId: STORE, locale: "fr", published: true, createdAt: T },
    { storeId: STORE, locale: "en", published: false, createdAt: T },
  ]);
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "ROBE", status: "ACTIVE", trackInventory: true, inventory: 10, createdAt: T, updatedAt: T });
});

async function checkout(query: string) {
  const response = await app.request(`/store/orders${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "robe", productName: "Robe", quantity: 1 }] }),
  });
  expect(response.status).toBe(201);
  const { data } = (await response.json()) as { data: { orderId: string } };
  return { orderId: data.orderId, contentLanguage: response.headers.get("Content-Language") };
}

const localeOf = async (orderId: string) => (await d1.db.select({ locale: schema.orders.locale }).from(schema.orders).where(eq(schema.orders.id, orderId)).get())!.locale;
const createdIn = async (orderId: string) => (await eventsOf(d1.db, orderId)).find((e) => e.type === "order.created")!.data.order.locale;

describe("a storefront order", () => {
  it("is placed in the language the shopper was served, and says so", async () => {
    const { orderId, contentLanguage } = await checkout("?locale=fr");
    expect(await localeOf(orderId)).toBe("fr");
    expect(contentLanguage).toBe("fr");
    expect(await createdIn(orderId)).toBe("fr");
  });

  it.each([
    ["a language the store has not published", "?locale=en"],
    ["a language it does not support", "?locale=de"],
    ["no language at all", ""],
  ])("is placed in the primary for %s", async (_, query) => {
    const { orderId, contentLanguage } = await checkout(query);
    expect(await localeOf(orderId)).toBe("ar");
    expect(contentLanguage).toBe("ar");
    expect(await createdIn(orderId)).toBe("ar");
  });

  it("is placed in the store's own primary, whichever it is", async () => {
    await d1.db.update(schema.stores).set({ lang: "fr" }).where(eq(schema.stores.id, STORE));
    const { orderId } = await checkout("?locale=en");
    expect(await localeOf(orderId)).toBe("fr");
  });
});

describe("an order the dashboard or an agent creates", () => {
  it.each([
    ["dashboard", { actor: { kind: "staff", id: "u1", name: "Nadia" }, origin: "dashboard" }],
    ["agent", { actor: { kind: "agent", id: "a1", name: "Assistant" }, origin: "agent" }],
  ] as const)("is placed in the store's primary language (%s)", async (_, author) => {
    await d1.db.update(schema.stores).set({ lang: "fr" }).where(eq(schema.stores.id, STORE));
    await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0661234567", wilaya: "Alger", createdAt: T });
    await createOrder(
      d1.db,
      { id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "Karim", phone: "0661234567", wilayaId: 16, price: 3000, deliveryFee: 600, createdAt: T, updatedAt: T },
      [{ id: "l1", orderId: "o1", productId: "robe", productName: "Robe", quantity: 1, pricePerUnit: 3000, lineTotal: 3000, createdAt: T }],
      author,
    );
    expect(await localeOf("o1")).toBe("fr");
    expect(await createdIn("o1")).toBe("fr");
  });
});

describe("an order placed before languages were recorded", () => {
  it("keeps none, and its events say so rather than guess", async () => {
    await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0661234567", wilaya: "Alger", createdAt: T });
    await d1.db.insert(schema.orders).values({ id: "old", orderNumber: "ORD-OLD", customerId: "c1", customerName: "Karim", phone: "0661234567", wilayaId: 16, price: 3000, deliveryFee: 600, status: "new", createdAt: T, updatedAt: T });
    const change = await updateOrderStatus(d1.db, "old", "confirmed", { actor: { kind: "staff", id: "u1", name: "Nadia" }, origin: "dashboard" });
    expect(change.ok).toBe(true);
    const [confirmed] = await eventsOf(d1.db, "old");
    expect(confirmed!.type).toBe("order.confirmed");
    expect(confirmed!.data.order.locale).toBeNull();
  });
});
