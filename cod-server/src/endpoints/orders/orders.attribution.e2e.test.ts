/**
 * Where an order came from, through the real routes on real D1 (attribution
 * v2): an order staff enter says who entered it, written in its batch; no one
 * names a source by hand; the order shows its channel, the ad and this visit;
 * the list shows each order's source and filters by it.
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

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-11-12T08:00:00.000Z";
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
  for (const table of [schema.shipments, schema.orderAttribution, schema.businessEvents, schema.stockMovements, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.activityLogs, schema.stores]) {
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

let phones = 0;

/** A storefront order as the storefront wrote it: the order and its attribution row. */
async function storefrontOrder(id: string, createdAt: string, row: Partial<typeof schema.orderAttribution.$inferInsert> | null) {
  const customerId = crypto.randomUUID();
  const phone = `066${String(++phones).padStart(7, "0")}`;
  await d1.db.insert(schema.customers).values({ id: customerId, name: "Amel", phone, wilaya: "Alger", createdAt });
  await d1.db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId, customerName: "Amel", phone, wilayaId: 16, communeId: commune16, price: 3000, status: "new", deliveryType: "home", orderType: "online", createdAt, updatedAt: createdAt });
  if (row) await d1.db.insert(schema.orderAttribution).values({ orderId: id, method: "captured", platform: "direct", createdAt, updatedAt: createdAt, ...row });
}

describe("an order staff enter", () => {
  it("says it was entered in the dashboard, written with the order", async () => {
    const id = await create();
    expect(await attributionOf(id)).toMatchObject({ method: "entered", channel: "dashboard", platform: "none" });
    expect((await call("GET", `/${id}`)).json.data.attribution).toMatchObject({ method: "entered", channel: "dashboard", ad: null, visit: null });
  });

  it("says it was entered by the AI agent", async () => {
    const tools = getOrderTools(d1.db, { userId: "u1", role: "admin", scopes: [], name: "Staff", email: "s@example.com" });
    const result = await (tools.createOrder as unknown as { execute: (args: unknown) => Promise<any> }).execute(entered());
    expect(result.success).toBe(true);
    const order = (await d1.db.select({ id: schema.orders.id }).from(schema.orders).get())!;
    expect(await attributionOf(order.id)).toMatchObject({ method: "entered", channel: "agent" });
  });

  it("takes no source named by hand, on creation or on an edit", async () => {
    const { status } = await call("POST", "", entered({ source: { source: "facebook" } }));
    expect(status).toBe(201);
    const id = (await d1.db.select({ id: schema.orders.id }).from(schema.orders).get())!.id;
    expect(await attributionOf(id)).toMatchObject({ channel: "dashboard", platform: "none", siteSource: null });
    await call("PATCH", `/${id}`, { notes: "x", source: { source: "instagram" } });
    expect(await attributionOf(id)).toMatchObject({ channel: "dashboard", siteSource: null });
  });
});

describe("the orders list", () => {
  beforeEach(async () => {
    await storefrontOrder("ad", "2026-11-12T06:18:00.000Z", { channel: "paid_social", platform: "meta", siteSource: "fb", namesJson: JSON.stringify({ campaign: "TEST2-campaign", ad: "TEST2-ad" }), utmMedium: "paid_social", visitChannel: "direct", visitPlatform: "direct" });
    await storefrontOrder("direct", "2026-11-12T06:10:00.000Z", { channel: "direct", visitChannel: "direct", visitPlatform: "direct" });
    await storefrontOrder("legacy", "2026-11-12T05:00:00.000Z", { platform: "meta", clickId: "IwAR2F4", clickIdType: "fbclid", capturedAt: "2026-11-10T03:30:00.000Z" });
    await storefrontOrder("before", "2026-11-01T05:00:00.000Z", null);
    await storefrontOrder("chosen", "2026-11-11T05:00:00.000Z", { method: "merchant", platform: "meta", siteSource: "wa" });
  });

  const listed = async (query = "") => {
    const { status, json } = await call("GET", `?archived=include${query}`);
    expect(status).toBe(200);
    return Object.fromEntries((json.data as Array<{ id: string; source: unknown }>).map((order) => [order.id, order.source]));
  };

  it("shows each order's source: the ad, direct, the team's, and unknown for a row written before v2", async () => {
    const id = await create();
    expect(await listed()).toEqual({
      ad: { channel: "paid_social", platform: "meta", app: "fb", adName: "TEST2-ad", campaignName: "TEST2-campaign" },
      direct: { channel: "direct", platform: "direct", app: null, adName: null, campaignName: null },
      legacy: null,
      before: null,
      chosen: { channel: "dashboard", platform: "meta", app: "wa", adName: null, campaignName: null },
      [id]: { channel: "dashboard", platform: "none", app: null, adName: null, campaignName: null },
    });
  });

  it("filters by channel, several at once, and by unknown, as each order shows", async () => {
    const id = await create();
    expect(Object.keys(await listed("&channel=paid_social"))).toEqual(["ad"]);
    expect(Object.keys(await listed("&channel=paid_social,direct")).sort()).toEqual(["ad", "direct"]);
    expect(Object.keys(await listed("&channel=unknown")).sort()).toEqual(["before", "legacy"]);
    expect(Object.keys(await listed("&channel=dashboard")).sort()).toEqual(["chosen", id].sort());
    expect(Object.keys(await listed("&channel=unknown,dashboard")).sort()).toEqual(["before", "chosen", "legacy", id].sort());
  });

  it("refuses a channel it does not know", async () => {
    expect((await call("GET", "?channel=facebook")).status).toBe(400);
  });
});
