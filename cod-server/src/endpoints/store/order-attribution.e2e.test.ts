/**
 * Order attribution on real D1 (attribution v2): a storefront order writes
 * its channel, the ad it credits (the last ad click within seven days) and
 * this visit, in the order's own batch; an old `_fbc` never credits an ad; a
 * basket order after a landing page names that page; what is unreadable is
 * dropped and the order is taken all the same; an abandoned checkout keeps
 * its touches.
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
const directVisit = () => ({ at: recently(0.1), params: {}, path: "/products/robe", ref: null });

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
  it("is written with the order: its channel, the ad it credits, and this visit apart", async () => {
    const last = adTouch();
    const first = firstTouch();
    const visit = directVisit();
    const { orderId, attribution } = await place({ attribution: { first, last, visit } });
    expect(attribution).toMatchObject({
      orderId,
      method: "captured",
      channel: "paid_social",
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
      visitAt: visit.at,
      visitChannel: "direct",
      visitPlatform: "direct",
      visitLandingPath: "/products/robe",
      visitLandingPageType: "product",
      visitReferrerHost: null,
    });
  });

  it("is direct for a visit that came with nothing, even with an old _fbc in the browser", async () => {
    const { attribution } = await place({ fbc: "fb.1.1794297000000.IwAR2F4", attribution: { first: null, last: null, visit: directVisit() } });
    expect(attribution).toMatchObject({ channel: "direct", platform: "direct", clickId: null, adId: null, visitChannel: "direct" });
  });

  it("credits no ad clicked more than seven days before the order", async () => {
    const stale = { ...adTouch(), at: recently(7 * 24 + 1) };
    expect((await place({ attribution: { first: null, last: stale, visit: directVisit() } })).attribution).toMatchObject({ channel: "direct", adId: null });
    const recent = { ...adTouch(), at: recently(7 * 24 - 1) };
    expect((await place({ attribution: { first: null, last: recent, visit: directVisit() } })).attribution).toMatchObject({ channel: "paid_social", adId: "120200000000000003" });
  });

  it("names a Facebook link that is not an ad as social, never as an ad", async () => {
    const link = { at: recently(0.2), params: { fbclid: "IwAR2F4" }, path: "/", ref: "m.facebook.com" };
    const { attribution } = await place({ attribution: { first: link, last: link, visit: link } });
    expect(attribution).toMatchObject({ channel: "organic_social", platform: "meta", siteSource: "fb", adId: null, visitChannel: "organic_social" });
  });

  it("names a search from the Google app on Android as Google search, and keeps the app as where the visit came from", async () => {
    const fromApp = { at: recently(0.1), params: {}, path: "/products/robe", ref: "com.google.android.googlequicksearchbox" };
    const { attribution } = await place({ attribution: { first: fromApp, last: null, visit: fromApp } });
    expect(attribution).toMatchObject({ channel: "organic_search", platform: "google", visitChannel: "organic_search", visitReferrerHost: "com.google.android.googlequicksearchbox" });
  });

  it("names a link opened from Gmail as email, never as Google search", async () => {
    const fromGmail = { at: recently(0.1), params: {}, path: "/", ref: "mail.google.com" };
    expect((await place({ attribution: { first: fromGmail, last: null, visit: fromGmail } })).attribution).toMatchObject({ channel: "email", platform: "other" });
  });

  it("keeps a Google search the order's source when the shopper came back typing the address, for 30 days", async () => {
    const search = (hoursAgo: number) => ({ at: recently(hoursAgo), params: {}, path: "/products/robe", ref: "www.google.com" });
    expect((await place({ attribution: { first: search(48), last: null, source: search(48), visit: directVisit() } })).attribution).toMatchObject({
      channel: "organic_search",
      platform: "google",
      referrerHost: "www.google.com",
      visitChannel: "direct",
    });
    expect((await place({ attribution: { first: null, last: null, source: search(31 * 24), visit: directVisit() } })).attribution).toMatchObject({ channel: "direct", visitChannel: "direct" });
  });

  it("credits the ad within seven days over a later search, and never an ad clicked earlier", async () => {
    const search = { at: recently(24), params: {}, path: "/", ref: "www.google.com" };
    expect((await place({ attribution: { first: null, last: adTouch(), source: search, visit: directVisit() } })).attribution).toMatchObject({ channel: "paid_social", adId: "120200000000000003" });
    const stale = { ...adTouch(), at: recently(8 * 24) };
    expect((await place({ attribution: { first: null, last: stale, source: search, visit: directVisit() } })).attribution).toMatchObject({ channel: "organic_search", adId: null, visitChannel: "direct" });
    expect((await place({ attribution: { first: null, last: stale, visit: stale } })).attribution?.channel).toBe("organic_social");
  });

  it("names a Google ad by its gad_source when Safari removed the gclid, with the campaign from gad_campaignid", async () => {
    const ad = { at: recently(1), params: { gad_source: "1", gad_campaignid: "21000000001" }, path: "/products/robe", ref: "www.google.com" };
    expect((await place({ attribution: { first: ad, last: ad, visit: ad } })).attribution).toMatchObject({ channel: "paid_search", platform: "google", campaignId: "21000000001", visitChannel: "paid_search" });
  });

  it("names Microsoft's and Snapchat's ads, and Merchant Center's free listings", async () => {
    const at = (params: Record<string, string>, ref: string | null = null) => ({ at: recently(1), params, path: "/", ref });
    expect((await place({ attribution: { first: null, last: at({ msclkid: "ab12" }), visit: at({ msclkid: "ab12" }) } })).attribution).toMatchObject({ channel: "paid_search", platform: "bing", clickIdType: "msclkid", clickId: "ab12" });
    expect((await place({ attribution: { first: null, last: at({ ScCid: "f00" }), visit: at({ ScCid: "f00" }) } })).attribution).toMatchObject({ channel: "paid_social", platform: "snapchat", clickIdType: "ScCid" });
    expect((await place({ attribution: { first: null, last: null, visit: at({ srsltid: "AfmBOo" }, "www.google.com") } })).attribution).toMatchObject({ channel: "organic_search", platform: "google" });
  });

  it("names a visit from an AI assistant apart from other sites", async () => {
    const fromChatGpt = { at: recently(0.1), params: { utm_source: "chatgpt.com" }, path: "/products/robe", ref: "chatgpt.com" };
    expect((await place({ attribution: { first: fromChatGpt, last: null, source: fromChatGpt, visit: fromChatGpt } })).attribution).toMatchObject({ channel: "ai_assistant", visitChannel: "ai_assistant", referrerHost: "chatgpt.com" });
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

  it("is absent when the storefront sent nothing, whatever _fbc the browser holds", async () => {
    expect((await place({})).attribution).toBeNull();
    expect((await place({ fbc: "fb.1.1709136167115.IwAR2F4" })).attribution).toBeNull();
  });

  it("drops what is unreadable, and the order is taken all the same", async () => {
    for (const attribution of ["{", 42, { first: { at: "yesterday", path: "/" } }, { last: { at: recently(1), params: { email: "a@b.dz" } } }]) {
      const placed = await place({ attribution });
      expect(placed.attribution, JSON.stringify(attribution)).toBeNull();
      expect(placed.landingPageId).toBeNull();
    }
  });

  it("keeps only the touch parameters a visit carried, never another key", async () => {
    const last = { ...adTouch(), params: { utm_source: "tiktok", utm_medium: "paid", phone: "0551234567" } };
    const { attribution } = await place({ attribution: { first: null, last } });
    expect(attribution).toMatchObject({ channel: "paid_social", platform: "tiktok", utmSource: "tiktok" });
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
        attribution: { first: firstTouch(), last: adTouch(), visit: null },
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
    const visit = directVisit();
    const source = { at: recently(30), params: {}, path: "/", ref: "www.google.com" };
    expect(JSON.parse((await save({ attribution: { first: null, last, source, visit } }))!)).toEqual({ first: null, last, source, visit });
    expect(JSON.parse((await save({ customerName: "Amel K." }))!)).toEqual({ first: null, last, source, visit });
  });

  it("stores nothing it could not read", async () => {
    expect(await save({ attribution: "not json" })).toBeNull();
  });
});
