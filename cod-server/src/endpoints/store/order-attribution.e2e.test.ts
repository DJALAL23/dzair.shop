/**
 * Order attribution on real D1: a storefront order writes the ad, the click
 * and the landing page its visit captured, in the order's own batch; a basket
 * order after a landing page names that page; what is unreadable is dropped
 * and the order is taken all the same; an abandoned checkout keeps its
 * touches.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { CheckoutAlreadyPlacedError, createStoreOrder, findOrCreateCustomer } from "../../../../cod-shared/queries/store";
import storeRouter from "./routes";
import storeAbandonedRouter from "../abandoned-orders/store-routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-10-01T00:00:00.000Z";
const STORE = "store-attribution";
const SESSION = "5f0c3a5e-8d2b-4c1e-9a7f-1b2c3d4e5f60";

const recently = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const adTouch = () => ({
  at: recently(2),
  params: {
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "120200000000000001",
    utm_term: "120200000000000002",
    utm_content: "120200000000000003",
    wc_cn: "Robe été",
    wc_pl: "Instagram_Stories",
    wc_ss: "ig",
    fbclid: "IwAR2F4-dbP0l7Mn1",
  },
  path: "/lp/robe-ete",
  ref: "l.instagram.com",
});

const firstTouch = () => ({ at: recently(30), params: {}, path: "/", ref: "google.com" });

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
  app.route("/store", storeAbandonedRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["order_attribution", "business_events", "order_products", "stock_movements", "orders", "abandoned_orders", "customers", "landing_pages", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "ROBE", status: "ACTIVE", trackInventory: true, inventory: 10, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.landingPages).values({ id: "lp-robe", slug: "robe-ete", name: "Robe été", productId: "robe", status: "published", publishedAt: T, createdAt: T, updatedAt: T });
});

async function place(extra: Record<string, unknown>) {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "robe", productName: "Robe", quantity: 1 }], ...extra }),
  });
  expect(response.status).toBe(201);
  const { data } = (await response.json()) as { data: { orderId: string } };
  const attribution = await d1.db.select().from(schema.orderAttribution).where(eq(schema.orderAttribution.orderId, data.orderId)).get();
  const order = await d1.db.select({ landingPageId: schema.orders.landingPageId }).from(schema.orders).where(eq(schema.orders.id, data.orderId)).get();
  return { orderId: data.orderId, attribution: attribution ?? null, landingPageId: order?.landingPageId ?? null };
}

describe("a storefront order's attribution", () => {
  it("is written with the order: the ad, the click and the landing page its visit captured", async () => {
    const last = adTouch();
    const first = firstTouch();
    const { orderId, attribution } = await place({ attribution: { first, last } });
    expect(attribution).toMatchObject({
      orderId,
      method: "captured",
      capturedAt: last.at,
      platform: "meta",
      clickId: "IwAR2F4-dbP0l7Mn1",
      clickIdType: "fbclid",
      campaignId: "120200000000000001",
      adsetId: "120200000000000002",
      adId: "120200000000000003",
      placement: "Instagram_Stories",
      siteSource: "ig",
      utmContent: "120200000000000003",
      namesJson: JSON.stringify({ campaign: "Robe été" }),
      landingPath: "/lp/robe-ete",
      landingPageType: "landing",
      referrerHost: "l.instagram.com",
      firstTouchAt: first.at,
      firstTouchJson: JSON.stringify(first),
    });
  });

  it("names the landing page a basket order's visit landed on", async () => {
    expect((await place({ attribution: { first: null, last: adTouch() } })).landingPageId).toBe("lp-robe");
  });

  it("keeps the landing page the form names over the visit's", async () => {
    await d1.db.insert(schema.landingPages).values({ id: "lp-other", slug: "autre", name: "Autre", productId: "robe", status: "published", publishedAt: T, createdAt: T, updatedAt: T });
    expect((await place({ landingPageSlug: "autre", attribution: { first: null, last: adTouch() } })).landingPageId).toBe("lp-other");
  });

  it("names no landing page the store has not published", async () => {
    await d1.db.update(schema.landingPages).set({ status: "draft" }).where(eq(schema.landingPages.id, "lp-robe"));
    const { landingPageId, attribution } = await place({ attribution: { first: null, last: adTouch() } });
    expect(landingPageId).toBeNull();
    expect(attribution?.landingPath).toBe("/lp/robe-ete");
  });

  it("names the Meta click of an _fbc when the visit sent no touch", async () => {
    expect((await place({ fbc: "fb.1.1709136167115.IwAR2F4" })).attribution).toMatchObject({ method: "captured", platform: "meta", clickId: "IwAR2F4", capturedAt: new Date(1709136167115).toISOString() });
  });

  it("is absent when the visit left nothing to credit", async () => {
    expect((await place({})).attribution).toBeNull();
  });

  it("drops what is unreadable, and the order is taken all the same", async () => {
    for (const attribution of ["{", 42, { first: { at: "yesterday", path: "/" } }, { last: { at: recently(1), params: { email: "a@b.dz" } } }]) {
      const placed = await place({ attribution });
      expect(placed.attribution, JSON.stringify(attribution)).toBeNull();
      expect(placed.landingPageId).toBeNull();
    }
  });

  it("keeps only the touch parameters a visit carried, never another key", async () => {
    const last = { ...adTouch(), params: { utm_source: "tiktok", phone: "0551234567" } };
    const { attribution } = await place({ attribution: { first: null, last } });
    expect(attribution).toMatchObject({ platform: "tiktok", utmSource: "tiktok" });
    expect(JSON.stringify(attribution)).not.toContain("0551234567");
  });

  it("is rolled back with the batch of an order that collides", async () => {
    const checkoutKey = "0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
    const first = await place({ checkoutKey, attribution: { first: null, last: adTouch() } });
    const customer = await findOrCreateCustomer(d1.db, { phone: "0551234567", name: "Amel Kaci", wilayaId: 16, communeId: "c-16-001" });
    await expect(
      createStoreOrder(d1.db, {
        customerId: customer.id,
        customerName: customer.name,
        phone: "0551234567",
        wilayaId: 16,
        communeId: "c-16-001",
        deliveryType: "home",
        quantity: 1,
        items: [{ productId: "robe", productName: "Robe", quantity: 1 }],
        deliveryFee: 600,
        checkoutKey,
        locale: "ar",
        attribution: { first: firstTouch(), last: adTouch() },
      }),
    ).rejects.toBeInstanceOf(CheckoutAlreadyPlacedError);
    expect(await d1.db.select({ orderId: schema.orderAttribution.orderId, firstTouchAt: schema.orderAttribution.firstTouchAt }).from(schema.orderAttribution)).toEqual([{ orderId: first.orderId, firstTouchAt: null }]);
  });

  it("is not written for an order that is refused", async () => {
    await d1.db.update(schema.products).set({ inventory: 0 }).where(eq(schema.products.id, "robe"));
    const response = await app.request("/store/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "robe", productName: "Robe", quantity: 1 }], attribution: { first: null, last: adTouch() } }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await d1.db.select().from(schema.orderAttribution)).toEqual([]);
  });
});

describe("an abandoned checkout's attribution", () => {
  async function save(extra: Record<string, unknown>) {
    const response = await app.request("/store/abandoned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION, customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, ...extra }),
    });
    expect(response.status).toBe(200);
    return (await d1.db.select({ attributionJson: schema.abandonedOrders.attributionJson }).from(schema.abandonedOrders).where(eq(schema.abandonedOrders.sessionId, SESSION)).get())?.attributionJson ?? null;
  }

  it("keeps the touches it was saved with, and a later save without them keeps them", async () => {
    const last = adTouch();
    expect(JSON.parse((await save({ attribution: { first: null, last } }))!)).toEqual({ first: null, last });
    expect(JSON.parse((await save({ customerName: "Amel K." }))!)).toEqual({ first: null, last });
  });

  it("stores nothing it could not read", async () => {
    expect(await save({ attribution: "not json" })).toBeNull();
  });
});
