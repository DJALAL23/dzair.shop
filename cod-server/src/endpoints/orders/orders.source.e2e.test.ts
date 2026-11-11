/**
 * The source of an order the merchant enters, through the real routes on real
 * D1: named with the order and written in its batch, changed or cleared by an
 * edit, shown on the order, never replacing a source captured from the
 * shopper's visit, and refused with an edit its shipment refuses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import ordersRouter from "./routes";
import { getOrderTools } from "./ai-tools";
import { updateOrder } from "../../../../cod-shared/queries/orders";
import type { Author } from "../../../../cod-shared/events/actor";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-11-11T08:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let commune16: string;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: [] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  commune16 = (await d1.raw.prepare("select id from communes where wilaya_id = 16 order by id limit 1").first<{ id: string }>())!.id;
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  const db = d1.db;
  for (const table of [schema.shipments, schema.drivers, schema.orderAttribution, schema.businessEvents, schema.stockMovements, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.activityLogs, schema.stores]) {
    await db.delete(table);
  }
  await db.insert(schema.stores).values({ id: "s1", name: "Store", createdAt: T, updatedAt: T });
  await db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 2000, hasVariants: false, inventory: 100, trackInventory: false, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T, updatedAt: T });
});

const entered = (extra: Record<string, unknown> = {}) => ({
  customerId: crypto.randomUUID(), customerName: "Karim B.", phone: "0551234567", wilayaId: 16, communeId: commune16, address: "12 Rue Didouche", deliveryType: "home" as const,
  orderType: "offline" as const, price: 2000, deliveryFee: 0,
  products: [{ productId: "robe", productName: "Robe", quantity: 1, pricePerUnit: 2000, lineTotal: 2000 }],
  ...extra,
});

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/orders${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json()) as any };
}

const create = async (extra: Record<string, unknown> = {}) => {
  const { status, json } = await call("POST", "", entered(extra));
  expect(status).toBe(201);
  return json.data.id as string;
};

const attributionOf = (orderId: string) => d1.db.select().from(schema.orderAttribution).where(eq(schema.orderAttribution.orderId, orderId)).get();

describe("the source of an order the merchant enters", () => {
  it("is written with the order, and shown on it", async () => {
    const id = await create({ source: { source: "whatsapp", campaignId: "120200000000000001", adId: "120200000000000003" } });
    expect(await attributionOf(id)).toMatchObject({ method: "merchant", platform: "meta", siteSource: "wa", campaignId: "120200000000000001", adId: "120200000000000003", capturedAt: null });
    const { json } = await call("GET", `/${id}`);
    expect(json.data.attribution).toMatchObject({ method: "merchant", source: "whatsapp", platform: "meta", campaignId: "120200000000000001", adId: "120200000000000003" });
  });

  it("is absent when the merchant names none", async () => {
    const id = await create();
    expect(await attributionOf(id)).toBeUndefined();
    expect((await call("GET", `/${id}`)).json.data.attribution).toBeNull();
  });

  it("refuses an id that is not the ad platform's, and a source it does not know", async () => {
    for (const source of [{ source: "facebook", adId: "abc" }, { source: "facebook", campaignId: "1".repeat(33) }, { source: "snapchat" }]) {
      expect((await call("POST", "", entered({ source }))).status, JSON.stringify(source)).toBe(400);
    }
    expect(await d1.db.select().from(schema.orders).all()).toEqual([]);
  });

  it("is changed and cleared by an edit", async () => {
    const id = await create({ source: { source: "phone" } });
    expect((await call("PATCH", `/${id}`, { source: { source: "instagram", adId: "120200000000000003" } })).status).toBe(200);
    expect(await attributionOf(id)).toMatchObject({ method: "merchant", platform: "meta", siteSource: "ig", adId: "120200000000000003" });

    const { status, json } = await call("PATCH", `/${id}`, { source: null });
    expect(status).toBe(200);
    expect(json.data.attribution).toBeNull();
    expect(await attributionOf(id)).toBeUndefined();
  });

  it("is named by an edit on an order that had none, and left as it is by an edit that does not name it", async () => {
    const id = await create();
    await call("PATCH", `/${id}`, { source: { source: "tiktok" } });
    await call("PATCH", `/${id}`, { notes: "Rappeler après 18h" });
    expect(await attributionOf(id)).toMatchObject({ platform: "tiktok", siteSource: null });
  });

  it("never replaces a source captured from the shopper's visit", async () => {
    const id = await create();
    await d1.db.insert(schema.orderAttribution).values({ orderId: id, method: "captured", platform: "meta", adId: "120200000000000009", capturedAt: T, createdAt: T, updatedAt: T });
    for (const source of [{ source: "phone" }, null]) {
      const { status, json } = await call("PATCH", `/${id}`, { notes: "x", source });
      expect(status).toBe(409);
      expect(json.code).toBe("ORDER_SOURCE_CAPTURED");
    }
    expect(await attributionOf(id)).toMatchObject({ method: "captured", adId: "120200000000000009" });
    expect((await d1.db.select({ notes: schema.orders.notes }).from(schema.orders).where(eq(schema.orders.id, id)).get())?.notes).toBeNull();
  });

  it("is never written over a captured source, even by an edit that skipped the check", async () => {
    const id = await create();
    await d1.db.insert(schema.orderAttribution).values({ orderId: id, method: "captured", platform: "meta", adId: "120200000000000009", capturedAt: T, createdAt: T, updatedAt: T });
    const author: Author = { actor: { kind: "staff", id: "u1", name: "Staff" }, origin: "dashboard" };
    expect(await updateOrder(d1.db, id, { source: { source: "phone" } }, author)).toEqual({ ok: true });
    expect(await updateOrder(d1.db, id, { source: null }, author)).toEqual({ ok: true });
    expect(await attributionOf(id)).toMatchObject({ method: "captured", platform: "meta", adId: "120200000000000009" });
  });

  it("is changed on an order with a shipment, and refused with an edit the shipment refuses", async () => {
    const id = await create({ source: { source: "phone" } });
    await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "A", lastName: "B", phone: "0661111111", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.shipments).values({ id: "sh1", orderId: id, kind: "driver", driverId: "dr1", handoffState: "accepted", deliveryType: "home", codAmount: 2000, revision: "r", createdAt: T, updatedAt: T });

    expect((await call("PATCH", `/${id}`, { source: { source: "messenger" } })).status).toBe(200);
    expect(await attributionOf(id)).toMatchObject({ siteSource: "msg" });

    expect((await call("PATCH", `/${id}`, { address: "Autre rue", source: { source: "facebook" } })).status).toBe(409);
    expect(await attributionOf(id)).toMatchObject({ siteSource: "msg" });
    expect((await call("PATCH", `/${id}`, { address: "Autre rue", source: null })).status).toBe(409);
    expect(await attributionOf(id)).toMatchObject({ siteSource: "msg" });
  });

  it("is named by the AI tool the same way", async () => {
    const tools = getOrderTools(d1.db, { userId: "u1", role: "admin", scopes: [], name: "Staff", email: "s@example.com" });
    const result = await (tools.createOrder as unknown as { execute: (args: unknown) => Promise<any> }).execute(entered({ source: { source: "messenger" } }));
    expect(result.success).toBe(true);
    const order = (await d1.db.select({ id: schema.orders.id }).from(schema.orders).get())!;
    expect(await attributionOf(order.id)).toMatchObject({ method: "merchant", platform: "meta", siteSource: "msg" });
  });
});
