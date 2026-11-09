/**
 * The store's Apps through the API, on real D1: the list a person sees is
 * the Apps their permissions open, each with where it stands; removing an App
 * forgets its setup and every key it holds, and nothing else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { DEFAULT_WHATSAPP_WIDGET_CONFIG, serializeWhatsAppWidgetConfig } from "../../../../cod-shared/whatsapp-widget/config";
import appsRouter from "./routes";

let d1: TestD1;
let admin: Api;
const T = "2026-10-26T08:00:00.000Z";
const as = (scopes: string[]) => apiAs(d1, staff(scopes), { "/api/apps": appsRouter });

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, { "/api/apps": appsRouter });
}, 120_000);

afterAll(async () => d1?.dispose());

const at = { createdAt: T, updatedAt: T };

/** A store with every App set up, and Meta's per-page pixel on one landing page. */
beforeEach(async () => {
  for (const table of [schema.landingPagePixelConfig, schema.landingPages, schema.products, schema.storePixelConfig, schema.storeOtpConfig, schema.storeTurnstileConfig, schema.storeEmailConfig, schema.stores]) {
    await d1.db.delete(table);
  }
  const widget = serializeWhatsAppWidgetConfig({ ...DEFAULT_WHATSAPP_WIDGET_CONFIG, enabled: true, phone: "+213551234567" });
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", whatsappWidgetJson: widget, ...at });
  await d1.db.insert(schema.storePixelConfig).values({ id: "p1", storeId: "s1", pixelId: "1", accessToken: "EAAG-store", enabled: true, ...at });
  await d1.db.insert(schema.storeOtpConfig).values({ id: "o1", storeId: "s1", apiKey: "dz-key", enabled: false, ...at });
  await d1.db.insert(schema.storeTurnstileConfig).values({ id: "t1", storeId: "s1", siteKey: "site", secretKey: "secret", enabled: true, ...at });
  await d1.db.insert(schema.storeEmailConfig).values({ id: "e1", storeId: "s1", apiKey: "sk-key", fromEmail: "shop@acme.dz", enabled: true, ...at });
  await d1.db.insert(schema.products).values({ id: "prod", name: "Zinc", handle: "zinc", price: 5000, status: "ACTIVE", ...at });
  await d1.db.insert(schema.landingPages).values({ id: "lp", slug: "lp-zinc", name: "Zinc", productId: "prod", status: "published", ...at });
  await d1.db.insert(schema.landingPagePixelConfig).values({ id: "lpp", landingPageId: "lp", pixelId: "2", accessToken: "EAAG-page", ...at });
});

async function setUp() {
  const [meta, pages, dzverify, turnstile, sendili, store] = await Promise.all([
    d1.db.select().from(schema.storePixelConfig).all(),
    d1.db.select().from(schema.landingPagePixelConfig).all(),
    d1.db.select().from(schema.storeOtpConfig).all(),
    d1.db.select().from(schema.storeTurnstileConfig).all(),
    d1.db.select().from(schema.storeEmailConfig).all(),
    d1.db.select({ widget: schema.stores.whatsappWidgetJson }).from(schema.stores).get(),
  ]);
  return { meta: meta.length, pages: pages.length, dzverify: dzverify.length, turnstile: turnstile.length, sendili: sendili.length, whatsappButton: store?.widget !== null };
}

const EVERYTHING = { meta: 1, pages: 1, dzverify: 1, turnstile: 1, sendili: 1, whatsappButton: true };

describe("the list of Apps", () => {
  it("shows an admin every App, in catalog order, with where it stands", async () => {
    const { status, body } = await admin.get("/api/apps");
    expect(status).toBe(200);
    expect(body.data).toEqual([
      { key: "meta", category: "marketing", status: "on" },
      { key: "dzverify", category: "checkout_protection", status: "off" },
      { key: "turnstile", category: "checkout_protection", status: "on" },
      { key: "order-protection", category: "checkout_protection", status: "not_set_up" },
      { key: "sendili", category: "messaging", status: "on" },
      { key: "whatsapp-button", category: "storefront", status: "on" },
      { key: "telegram", category: "messaging", status: "not_set_up" },
      { key: "reviews", category: "storefront", status: "on" },
    ]);
  });

  it("shows a staff member only the Apps they may see", async () => {
    const { body } = await as(["dzverify:read", "sendili:manage", "orders:read"]).get("/api/apps");
    expect(body.data.map((app: { key: string }) => app.key)).toEqual(["dzverify"]);
  });

  it("is refused to someone who may see no App", async () => {
    expect((await as(["orders:read", "integrations:read"]).get("/api/apps")).status).toBe(403);
  });
});

describe("removing an App", () => {
  it("forgets DZVerify's setup and nothing else", async () => {
    expect((await admin.delete("/api/apps/dzverify")).status).toBe(200);
    expect(await setUp()).toEqual({ ...EVERYTHING, dzverify: 0 });
    expect((await admin.get("/api/apps")).body.data[1]).toEqual({ key: "dzverify", category: "checkout_protection", status: "not_set_up" });
  });

  it("forgets Turnstile's and Sendili's keys", async () => {
    await admin.delete("/api/apps/turnstile");
    await admin.delete("/api/apps/sendili");
    expect(await setUp()).toEqual({ ...EVERYTHING, turnstile: 0, sendili: 0 });
  });

  it("forgets every Meta key, the landing pages' own too, and keeps Meta conversions", async () => {
    await admin.delete("/api/apps/meta");
    expect(await setUp()).toEqual({ ...EVERYTHING, meta: 0, pages: 0 });
    expect(await d1.db.select({ id: schema.eventConsumers.id }).from(schema.eventConsumers).where(eq(schema.eventConsumers.kind, "meta_capi")).all()).toEqual([{ id: "meta-conversions" }]);
    expect(await d1.db.select({ id: schema.landingPages.id }).from(schema.landingPages).all()).toEqual([{ id: "lp" }]);
  });

  it("takes the WhatsApp button off the storefront", async () => {
    await admin.delete("/api/apps/whatsapp-button");
    expect(await setUp()).toEqual({ ...EVERYTHING, whatsappButton: false });
  });

  it("takes the App's own manage permission", async () => {
    expect((await as(["dzverify:read", "turnstile:manage"]).delete("/api/apps/dzverify")).status).toBe(403);
    expect((await as(["dzverify:manage"]).delete("/api/apps/dzverify")).status).toBe(200);
    expect(await setUp()).toEqual({ ...EVERYTHING, dzverify: 0 });
  });

  it("does nothing more for an App that is not set up", async () => {
    await admin.delete("/api/apps/sendili");
    expect((await admin.delete("/api/apps/sendili")).status).toBe(200);
    expect(await setUp()).toEqual({ ...EVERYTHING, sendili: 0 });
  });
});
