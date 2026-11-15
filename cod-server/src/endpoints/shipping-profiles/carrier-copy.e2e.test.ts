/**
 * Copying a delivery company's rates into a shipping profile, through the real
 * routes on real D1, for a carrier that prices per commune (ZR, Yalidine) and
 * one that prices per wilaya (NOEST, EcoTrack): the preview writes nothing,
 * the copy makes each wilaya and commune price, a later edit keeps the commune
 * prices, and a product on the profile is charged what was copied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { signIn } from "@/test-utils/sign-in";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { communesOf } from "../../../../cod-shared/places";
import profilesRouter from "./routes";
import storeRouter from "../store/routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-11-12T08:00:00.000Z";
const ALGER = communesOf(16).map((c) => c.id);
const BLIDA = communesOf(9).map((c) => c.id);
let d1: TestD1;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("/api/*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: [] } as never);
    await next();
  });
  app.use("/store/*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("storeId", "s1");
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/shipping-profiles", profilesRouter);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  for (const table of [schema.orderProducts, schema.orders, schema.products, schema.carrierPlaces, schema.deliveryCompanies, schema.shippingProfiles, schema.stores]) await d1.db.delete(table);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values([
    { id: "default", name: "Standard", isDefault: true, createdAt: T, updatedAt: T },
    { id: "carrier", name: "Transporteur", isDefault: false, createdAt: T, updatedAt: T },
  ]);
  await d1.db.insert(schema.shippingRules).values({ id: "d16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 400, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "c31", profileId: "carrier", wilayaId: 31, homePrice: 999, stopDeskPrice: 999, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "SKU-robe", status: "ACTIVE", trackInventory: false, shippingProfileId: "carrier", createdAt: T, updatedAt: T });
});

async function company(id: string, places: Array<{ communeId: string; home?: boolean; homeRate: number | null; stopDeskRate: number | null }>, synced = true) {
  await d1.db.insert(schema.deliveryCompanies).values({ id, name: id.toUpperCase(), nameAr: id, code: id, placesSyncedAt: synced ? T : null, createdAt: T, updatedAt: T });
  for (let i = 0; i < places.length; i += 8) {
    await d1.db.insert(schema.carrierPlaces).values(
      places.slice(i, i + 8).map((p) => ({ companyId: id, communeId: p.communeId, wilayaRef: "w", wilayaNumber: 1, wilayaName: "w", communeRef: p.communeId, communeName: p.communeId, home: p.home ?? true, homeRate: p.homeRate, stopDeskRate: p.stopDeskRate, homeReturnFee: null, stopDeskReturnFee: null })),
    );
  }
}

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json()) as any };
};
const preview = (body: unknown) => call("POST", "/api/shipping-profiles/carrier/carrier-rates/preview", body);
const copy = (body: unknown) => call("PUT", "/api/shipping-profiles/carrier/carrier-rates", body);
const fee = async (communeId: string, deliveryType: "home" | "stop_desk" = "home") =>
  (await call("POST", "/store/cart/validate", { productId: "robe", productName: "Robe", destination: { wilayaId: Number(communeId.split("-")[1]), communeId, deliveryType } })).json.data.delivery;

describe("copying a delivery company's rates into a profile", () => {
  beforeEach(async () => {
    const [own, noDoor] = ALGER;
    await company("zr", [...ALGER.slice(2).map((communeId) => ({ communeId, homeRate: 420, stopDeskRate: 300 })), { communeId: own!, homeRate: 640, stopDeskRate: 300 }, { communeId: noDoor!, home: false, homeRate: null, stopDeskRate: 300 }]);
    await company("noest", BLIDA.map((communeId) => ({ communeId, homeRate: 500, stopDeskRate: 350 })));
  });

  it("previews each wilaya before and after, and writes nothing", async () => {
    const { status, json } = await preview({ companyId: "zr", add: 100, roundTo: 50 });
    expect(status).toBe(200);
    expect(json.data.company).toMatchObject({ id: "zr", name: "ZR", placesSyncedAt: T });
    expect(json.data.wilayas).toEqual([
      { wilayaId: 16, before: null, after: { homePrice: 550, stopDeskPrice: 400, homeEnabled: true, stopDeskEnabled: true, communes: 2 } },
      { wilayaId: 31, before: { homePrice: 999, stopDeskPrice: 999, homeEnabled: true, stopDeskEnabled: true, communes: 0 }, after: null },
    ]);
    expect((await d1.db.select().from(schema.shippingRules).where(eq(schema.shippingRules.profileId, "carrier")).all()).map((r) => r.wilayaId)).toEqual([31]);
  });

  it("copies a per-commune carrier, and a product on the profile is charged what was copied", async () => {
    const [own, noDoor, other] = ALGER;
    expect((await copy({ companyId: "zr", add: 100, roundTo: 50 })).status).toBe(200);
    expect(await fee(other!)).toEqual({ available: true, fee: 550, total: 3550 });
    expect(await fee(own!)).toEqual({ available: true, fee: 750, total: 3750 });
    expect(await fee(noDoor!)).toEqual({ available: false, fee: null, total: null });
    expect(await fee(noDoor!, "stop_desk")).toEqual({ available: true, fee: 400, total: 3400 });
    expect((await fee("c-31-001")).available).toBe(false);
  });

  it("copies a per-wilaya carrier as one price a wilaya, at the carrier's price when nothing is added", async () => {
    expect((await copy({ companyId: "noest" })).status).toBe(200);
    const rules = await d1.db.select().from(schema.shippingRules).where(eq(schema.shippingRules.profileId, "carrier")).all();
    expect(rules.map((r) => ({ wilayaId: r.wilayaId, homePrice: r.homePrice, stopDeskPrice: r.stopDeskPrice }))).toEqual([{ wilayaId: 9, homePrice: 500, stopDeskPrice: 350 }]);
    expect(await d1.db.select().from(schema.shippingRuleCommunes).all()).toEqual([]);
    expect(await fee(BLIDA[3]!)).toEqual({ available: true, fee: 500, total: 3500 });
  });

  it("keeps the copied commune prices when the merchant later edits the wilaya prices", async () => {
    const [own] = ALGER;
    await copy({ companyId: "zr" });
    const rules = (await call("GET", "/api/shipping-profiles/carrier")).json.data.rules;
    await call("PUT", "/api/shipping-profiles/carrier/rules", { rules: rules.map((r: any) => ({ wilayaId: r.wilayaId, homePrice: r.homePrice + 30, stopDeskPrice: r.stopDeskPrice, homeEnabled: r.homeEnabled, stopDeskEnabled: r.stopDeskEnabled })) });
    expect((await fee(ALGER[5]!)).fee).toBe(450);
    expect((await fee(own!)).fee).toBe(640);
  });

  it("leaves the store's default profile and other products alone", async () => {
    await copy({ companyId: "zr", add: 100 });
    const rules = await d1.db.select().from(schema.shippingRules).where(eq(schema.shippingRules.profileId, "default")).all();
    expect(rules.map((r) => [r.wilayaId, r.homePrice])).toEqual([[16, 600]]);
  });
});

describe("refusals, which change nothing", () => {
  it("before the company's places are read, and when it gives no price", async () => {
    await company("guepex", [], false);
    await company("empty", BLIDA.map((communeId) => ({ communeId, homeRate: null, stopDeskRate: null })));
    expect((await copy({ companyId: "guepex" })).json.code).toBe("CARRIER_PLACES_NOT_READ");
    expect((await copy({ companyId: "empty" })).json.code).toBe("CARRIER_RATES_MISSING");
    expect((await copy({ companyId: "missing" })).status).toBe(404);
    expect((await call("PUT", "/api/shipping-profiles/nope/carrier-rates", { companyId: "empty" })).status).toBe(404);
    expect((await copy({ companyId: "empty", add: -1 })).status).toBe(400);
    expect((await copy({ companyId: "empty", roundTo: 25 })).status).toBe(400);
    expect((await d1.db.select().from(schema.shippingRules).where(eq(schema.shippingRules.profileId, "carrier")).all()).map((r) => r.homePrice)).toEqual([999]);
  });
});
