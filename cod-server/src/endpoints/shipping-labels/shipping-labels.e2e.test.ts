/**
 * Labels and delivery sheets for the store's own drivers, through the real
 * routes on real D1.
 *
 * Proved: a store reads the default settings until it saves its own, which
 * are checked whole and stored as NULL when they are the defaults; a label
 * prints the parcel as its order and shipment hold it — the customer, the
 * place in both languages, the cash frozen at handoff, the lines, the
 * driver — and the store as sender; a carrier's shipment is never labelled
 * here; a delivery sheet holds what is still out with the driver; customer
 * data takes order access, and settings delivery access; a hundred labels
 * cost the trips of two.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { SYSTEM } from "@/test-utils/events";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { countingD1 } from "@/test-utils/counting-d1";
import * as schema from "@/db/schema";
import { handOffToDriver } from "../../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import labelsRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-24T08:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = [];
let commune16: { id: string; name: string; nameAr: string };

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/shipping-labels", labelsRouter);
  const [commune] = (await d1.raw.prepare("select id, name, name_ar as nameAr from communes where wilaya_id = 16 order by id limit 1").all<{ id: string; name: string; nameAr: string }>()).results;
  commune16 = commune;
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["orders:read", "delivery:read", "delivery:manage"];
  const db = d1.db;
  for (const table of [schema.shipmentEvents, schema.shipments, schema.orderProducts, schema.orders, schema.customers, schema.driverCompensations, schema.drivers, schema.deliveryCompanies, schema.storeLegalProfile, schema.stores]) {
    await db.delete(table);
  }
  await db.insert(schema.stores).values({ id: "s1", name: "Maison Lina", logoUrl: "https://media.example.com/logo.webp", currency: "DZD", currencySymbol: "دج", createdAt: T, updatedAt: T });
  await db.insert(schema.storeLegalProfile).values({ storeId: "s1", address: "12 Rue Didouche Mourad, Alger", contactPhone: "0661234567", updatedAt: T });
  await db.insert(schema.customers).values({ id: "c1", name: "Amina", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await db.insert(schema.drivers).values([
    { id: "dr1", firstName: "Samir", lastName: "Bey", phone: "0770000001", createdAt: T, updatedAt: T },
    { id: "dr2", firstName: "Yacine", lastName: "K", phone: "0770000002", createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.deliveryCompanies).values({ id: "co1", name: "Yalidine", nameAr: "-", code: "yalidine", provider: "yalidine", createdAt: T, updatedAt: T });
});

async function readyOrder(id: string, overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  await d1.db.insert(schema.orders).values({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "أمينة بن علي", phone: "0551234567", wilayaId: 16, communeId: commune16.id,
    address: "Cité 200 Logements, Bt 4", price: 3200, deliveryFee: 500, status: "ready", notes: "Appeler avant", createdAt: T, updatedAt: T, ...overrides,
  });
  await d1.db.insert(schema.orderProducts).values([
    { id: `${id}-l1`, orderId: id, productName: "Robe", variantLabel: "M / Rouge", quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: T },
    { id: `${id}-l2`, orderId: id, productName: "Foulard", quantity: 1, pricePerUnit: 1200, lineTotal: 1200, createdAt: "2026-10-24T08:00:01.000Z" },
  ]);
}

async function givenToDriver(ids: string[], driverId = "dr1") {
  for (const id of ids) await readyOrder(id);
  const handed = await handOffToDriver(d1.db, { orderIds: ids, driverId, author: SYSTEM });
  return handed.map((r) => {
    if (!r.ok) throw new Error(r.reason);
    return r.shipmentId;
  });
}

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};
const stored = async () => (await d1.db.select({ json: schema.stores.shippingLabelJson }).from(schema.stores).get())!.json;

describe("label settings", () => {
  it("are the defaults, with the store as sender, until the store saves its own", async () => {
    const { status, body } = await call("GET", "/api/shipping-labels/settings");
    expect(status).toBe(200);
    expect(body.data).toEqual({
      config: { size: "100x150", language: "fr", showLogo: true, senderPhone: null, showItems: true, showNotes: true, openParcel: "unset", footer: null },
      sender: { name: "Maison Lina", logoUrl: "https://media.example.com/logo.webp", phone: "0661234567", address: "12 Rue Didouche Mourad, Alger" },
      legalPhone: "0661234567",
      currency: { code: "DZD", symbol: "دج" },
    });
  });

  it("are saved whole, print the sender phone they name, and the defaults store nothing", async () => {
    const saved = await call("PUT", "/api/shipping-labels/settings", { language: "ar", openParcel: "allowed", senderPhone: "023 45 67 89", footer: "شكرا لثقتكم" });
    expect(saved.status).toBe(200);
    expect(saved.body.data.config).toMatchObject({ language: "ar", openParcel: "allowed", senderPhone: "023 45 67 89", footer: "شكرا لثقتكم", showItems: true });
    expect(saved.body.data.sender.phone).toBe("023 45 67 89");
    expect(saved.body.data.legalPhone).toBe("0661234567");
    expect(JSON.parse((await stored())!)).toMatchObject({ language: "ar", openParcel: "allowed" });

    expect((await call("PUT", "/api/shipping-labels/settings", {})).status).toBe(200);
    expect(await stored()).toBeNull();
  });

  it("are refused with every problem at once", async () => {
    const { status, body } = await call("PUT", "/api/shipping-labels/settings", { language: "en", footer: 3, colour: "red" });
    expect(status).toBe(400);
    expect(body.context.issues.map((i: any) => [i.path, i.code])).toEqual([["colour", "UNKNOWN_KEY"], ["language", "INVALID_CHOICE"], ["footer", "INVALID_FIELD"]]);
    expect(await stored()).toBeNull();
  });

  it("are read with delivery access and changed with delivery management", async () => {
    scopes = ["delivery:read"];
    expect((await call("GET", "/api/shipping-labels/settings")).status).toBe(200);
    expect((await call("PUT", "/api/shipping-labels/settings", { language: "ar" })).status).toBe(403);
    scopes = ["orders:read"];
    expect((await call("GET", "/api/shipping-labels/settings")).status).toBe(403);
  });
});

describe("the labels of driver shipments", () => {
  it("print each parcel as its order and shipment hold it, in the order asked", async () => {
    const [first, second] = await givenToDriver(["o1", "o2"]);
    const { status, body } = await call("POST", "/api/shipping-labels", { shipmentIds: [second, first] });
    expect(status).toBe(200);
    expect(body.data.parcels.map((p: any) => p.orderNumber)).toEqual(["ORD-o2", "ORD-o1"]);
    expect(body.data.parcels[1]).toEqual({
      shipmentId: first,
      orderNumber: "ORD-o1",
      handedAt: expect.any(String),
      amount: 3700,
      recipient: {
        name: "أمينة بن علي",
        phone: "0551234567",
        wilaya: { name: "Alger", nameAr: "الجزائر" },
        commune: { name: commune16.name, nameAr: commune16.nameAr },
        address: "Cité 200 Logements, Bt 4",
      },
      items: [
        { name: "Robe", variant: "M / Rouge", quantity: 2 },
        { name: "Foulard", variant: null, quantity: 1 },
      ],
      notes: "Appeler avant",
      driver: { name: "Samir Bey", phone: "0770000001" },
    });
    expect(body.data.sender.name).toBe("Maison Lina");
    expect(body.data.missing).toEqual([]);
  });

  it("never labels a carrier's parcel, which prints its own", async () => {
    const [driverShipment] = await givenToDriver(["o1"]);
    await readyOrder("o2");
    await d1.db.insert(schema.shipments).values({ id: "carrier-1", orderId: "o2", kind: "carrier", companyId: "co1", handoffState: "accepted", carrierParcelId: "P1", trackingNumber: "T1", deliveryType: "home", codAmount: 3700, revision: "r", createdAt: T, updatedAt: T });
    const { body } = await call("POST", "/api/shipping-labels", { shipmentIds: ["carrier-1", driverShipment, "nope"] });
    expect(body.data.parcels.map((p: any) => p.shipmentId)).toEqual([driverShipment]);
    expect(body.data.missing).toEqual(["carrier-1", "nope"]);
  });

  it("take order access, and at most a hundred at a time", async () => {
    const [id] = await givenToDriver(["o1"]);
    scopes = ["delivery:read", "delivery:manage"];
    expect((await call("POST", "/api/shipping-labels", { shipmentIds: [id] })).status).toBe(403);
    scopes = ["orders:read"];
    expect((await call("POST", "/api/shipping-labels", { shipmentIds: [] })).status).toBe(400);
    expect((await call("POST", "/api/shipping-labels", { shipmentIds: Array.from({ length: 101 }, (_, i) => `s${i}`) })).status).toBe(400);
  });

  it("cost as many database trips for fifty as for two", async () => {
    const tripsFor = async (ids: string[]) => {
      const shipmentIds = await givenToDriver(ids);
      const counted = countingD1(d1.raw);
      dbModule.getDb.mockReturnValue(drizzle(counted.raw, { schema }) as never);
      const { body } = await call("POST", "/api/shipping-labels", { shipmentIds });
      dbModule.getDb.mockReturnValue(d1.db);
      expect(body.data.parcels).toHaveLength(ids.length);
      return counted.trips();
    };
    const two = await tripsFor(["a1", "a2"]);
    expect(await tripsFor(Array.from({ length: 50 }, (_, i) => `b${i}`))).toBe(two);
    expect(two).toBe(1);
  });
});

describe("a driver's delivery sheet", () => {
  it("holds what is still out with the driver, in the order given, and what to collect in all", async () => {
    const [first, second, delivered] = await givenToDriver(["o1", "o2", "o3"]);
    await givenToDriver(["other"], "dr2");
    await recordShipmentEvents(d1.db, delivered, [
      { source: "merchant", status: { vocabulary: "driver", value: "delivered" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() },
    ], SYSTEM);
    const { status, body } = await call("GET", "/api/shipping-labels/delivery-sheet/dr1");
    expect(status).toBe(200);
    expect(body.data.driver).toEqual({ id: "dr1", name: "Samir Bey", phone: "0770000001" });
    expect(body.data.parcels.map((p: any) => p.shipmentId)).toEqual([first, second]);
    expect(body.data.parcels[0].items).toHaveLength(2);
    expect(body.data.total).toEqual({ parcels: 2, amount: 7400 });
  });

  it("is not found for a driver who does not exist, and takes order access", async () => {
    expect((await call("GET", "/api/shipping-labels/delivery-sheet/nobody")).status).toBe(404);
    scopes = ["delivery:read"];
    expect((await call("GET", "/api/shipping-labels/delivery-sheet/dr1")).status).toBe(403);
  });
});

describe("a store with no legal profile", () => {
  it("prints its name and the label settings' phone, and nothing it does not have", async () => {
    await d1.db.delete(schema.storeLegalProfile);
    await call("PUT", "/api/shipping-labels/settings", { senderPhone: "0551 00 00 00" });
    const [id] = await givenToDriver(["o1"]);
    const { body } = await call("POST", "/api/shipping-labels", { shipmentIds: [id] });
    expect(body.data.sender).toEqual({ name: "Maison Lina", logoUrl: "https://media.example.com/logo.webp", phone: "0551 00 00 00", address: null });
    await d1.db.update(schema.stores).set({ shippingLabelJson: null }).where(eq(schema.stores.id, "s1"));
  });
});
