/**
 * One checkout, one order (migration 0062), through the real storefront route
 * on real D1: a checkout attempt sent again — a double click, a resubmitted
 * form, a retried request, or copies racing — gets back the order it already
 * placed, with one stock deduction and one order.created; the same key for
 * another phone is never merged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { eventsOf } from "@/test-utils/events";
import * as schema from "@/db/schema";
import storeRouter from "./routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-10-01T00:00:00.000Z";
const STORE = "store-once";
const realFetch = globalThis.fetch;

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
  for (const table of ["business_events", "order_products", "order_status_history", "stock_movements", "orders", "customers", "products", "shipping_rules", "shipping_profiles", "store_turnstile_config", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", lang: "fr", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, sku: "ROBE", status: "ACTIVE", trackInventory: true, inventory: 10, createdAt: T, updatedAt: T });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = "6f1c2a0e-8b1d-4c3a-9e2f-0a1b2c3d4e5f";

async function checkout(extra: Record<string, unknown> = {}, phone = "0551234567") {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone, wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "robe", productName: "Robe", quantity: 2 }], ...extra }),
  });
  return { status: response.status, json: (await response.json()) as any };
}

const orderRows = () => d1.db.select().from(schema.orders).all();
const stock = async () => (await d1.db.select({ n: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, "robe")).get())!.n;

describe("a checkout sent again", () => {
  it("answers with the order it placed, exactly as the first time, and places nothing more", async () => {
    const first = await checkout({ checkoutKey: KEY });
    const again = await checkout({ checkoutKey: KEY });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.json).toEqual(first.json);
    expect(first.json.data).toMatchObject({ price: 6000, deliveryFee: 600, total: 6600 });

    const [order] = await orderRows();
    expect(await orderRows()).toHaveLength(1);
    expect(order!.checkoutKey).toBe(KEY);
    expect(await stock()).toBe(8);
    expect((await eventsOf(d1.db, order!.id)).map((e) => e.type)).toEqual(["order.created"]);
  });

  it("places one order when copies arrive at once", async () => {
    const answers = await Promise.all(Array.from({ length: 3 }, () => checkout({ checkoutKey: KEY })));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201]);
    expect(new Set(answers.map((a) => a.json.data.orderId)).size).toBe(1);
    expect(await orderRows()).toHaveLength(1);
    expect(await stock()).toBe(8);
  });

  it("is refused for another phone, and never merged into the order it placed", async () => {
    await checkout({ checkoutKey: KEY });
    const other = await checkout({ checkoutKey: KEY }, "0661234567");
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("CHECKOUT_KEY_IN_USE");
    expect(await orderRows()).toHaveLength(1);
  });

  it("is answered even though its bot check was spent by the first request", async () => {
    await d1.db.insert(schema.storeTurnstileConfig).values({ id: "ts", storeId: STORE, siteKey: "site", secretKey: "secret", enabled: true, createdAt: T, updatedAt: T });
    const spent = new Set<string>();
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("challenges.cloudflare.com")) return realFetch(url, init);
      const token = new URLSearchParams(String(init?.body)).get("response") ?? JSON.parse(String(init?.body)).response;
      const ok = !spent.has(token);
      spent.add(token);
      return Response.json({ success: ok, "error-codes": ok ? [] : ["timeout-or-duplicate"] });
    }) as typeof fetch;

    const first = await checkout({ checkoutKey: KEY, turnstileToken: "tok-1" });
    expect(first.status).toBe(201);
    const again = await checkout({ checkoutKey: KEY, turnstileToken: "tok-1" });
    expect(again.status).toBe(201);
    expect(again.json.data.orderId).toBe(first.json.data.orderId);
    expect((await checkout({ turnstileToken: "tok-1" })).status).not.toBe(201);
  });
});

describe("checkouts that are not the same", () => {
  it("each place their order: different keys, or no key at all", async () => {
    await checkout({ checkoutKey: KEY });
    await checkout({ checkoutKey: "0e2b7f6a-1c3d-4e5f-8a9b-0c1d2e3f4a5b" });
    await checkout();
    await checkout();
    expect(await orderRows()).toHaveLength(4);
  });

  it("a key that is not a UUID is refused before anything is placed", async () => {
    const res = await checkout({ checkoutKey: "not-a-key" });
    expect(res.status).toBe(400);
    expect(await orderRows()).toHaveLength(0);
  });
});
