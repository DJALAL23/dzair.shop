/**
 * The order snapshot D1 builds for a Business Event, on real D1: every branch
 * of it holds to the catalogue's schema, whatever the order holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import fc from "fast-check";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { EVENT_DATA_SCHEMAS } from "@/events/catalogue";
import * as schema from "../db/schema";
import { orderSnapshot, shipmentSnapshot, type OrderSnapshot } from "./snapshots";

let d1: TestD1;
const T0 = "2026-10-20T08:00:00.000Z";
const orderSchema = EVENT_DATA_SCHEMAS["order.created"].shape.order;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.shipments, schema.deliveryCompanies, schema.orderProducts, schema.orders, schema.customers]) await d1.db.delete(table);
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
});

async function order(id: string, extra: Partial<typeof schema.orders.$inferInsert> = {}) {
  await d1.db.insert(schema.orders).values({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", price: 5000, deliveryFee: 400, codAmount: 5400,
    status: "new", createdAt: T0, updatedAt: T0, ...extra,
  });
}

async function snapshot(id: string): Promise<OrderSnapshot> {
  const row = await d1.db.get<{ s: string }>(sql`select ${orderSnapshot(id).sql} as s`);
  const parsed = orderSchema.safeParse(JSON.parse(row!.s));
  if (!parsed.success) throw new Error(`the snapshot breaks the schema: ${parsed.error.message}`);
  return parsed.data;
}

describe("the order snapshot", () => {
  it("holds coupons, offers, gifts, custom answers and the order of its lines", async () => {
    await order("o1", {
      wilayaId: 16, communeId: "c-16-001", customerEmail: "k@example.com", couponCode: "AID10", couponDiscount: 500,
      deliveryOfferName: "Livraison offerte", deliveryType: "stop_desk", stationCode: "16A",
      customFieldsJson: JSON.stringify([{ id: "f1", label: "Taille", type: "select", value: "M" }]),
    });
    await d1.db.insert(schema.orderProducts).values([
      { id: "b", orderId: "o1", productId: null, productName: "Foulard", quantity: 1, pricePerUnit: 0, lineTotal: 0, reward: true, offerName: "Un foulard offert", createdAt: "2026-10-20T08:00:02.000Z" },
      { id: "a", orderId: "o1", productId: null, productName: "Robe", variantLabel: "Rouge / M", sku: "RB", quantity: 2, pricePerUnit: 2750, lineTotal: 5000, discount: 500, createdAt: "2026-10-20T08:00:01.000Z" },
    ]);

    expect(await snapshot("o1")).toMatchObject({
      customer: { email: "k@example.com" },
      destination: { wilaya: { id: 16, name: "Alger" }, commune: { id: "c-16-001" }, deliveryType: "stop_desk", stationCode: "16A" },
      coupon: { code: "AID10", discount: { amount: "500.00", currency: "DZD" } },
      freeDeliveryOffer: { id: null, name: "Livraison offerte" },
      customFields: [{ id: "f1", label: "Taille", type: "select", value: "M" }],
      lines: [
        { id: "a", gift: false, offer: null, variantLabel: "Rouge / M", discount: { amount: "500.00" }, total: { amount: "5000.00" } },
        { id: "b", gift: true, offer: { id: null, name: "Un foulard offert" }, unitPrice: { amount: "0.00" } },
      ],
    });
  });

  it("holds an order with no lines, no place, no coupon and no answers", async () => {
    await order("o1");
    expect(await snapshot("o1")).toMatchObject({ lines: [], destination: { wilaya: null, commune: null }, coupon: null, freeDeliveryOffer: null, customFields: [] });
  });

  it("never lets a malformed answers column break the event", async () => {
    await order("o1", { customFieldsJson: "{not json" });
    expect((await snapshot("o1")).customFields).toEqual([]);
  });

  it("writes every time in UTC ISO, whatever form it was stored in", async () => {
    await order("o1", { createdAt: "2026-10-20 08:00:00" });
    expect((await snapshot("o1")).placedAt).toBe("2026-10-20T08:00:00.000Z");
  });

  it("writes any amount stored to the centime as that exact amount", async () => {
    const centimes = fc.sample(fc.integer({ min: 0, max: 10_000_000_00 }), 200).concat([0, 1, 30, 267, 9_999, 123_450, 10_000_000_00]);
    for (const [i, c] of centimes.entries()) await order(`p${i}`, { price: c / 100 });
    for (const [i, c] of centimes.entries()) {
      const expected = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
      expect((await snapshot(`p${i}`)).subtotal.amount, `${c} centimes`).toBe(expected);
    }
  });
});

describe("the shipment snapshot", () => {
  const shipmentSchema = EVENT_DATA_SCHEMAS["shipment.voided"].shape.shipment;

  it("holds a carrier kept from before carriers had adapters, and a status with no label", async () => {
    await order("o1");
    await d1.db.insert(schema.deliveryCompanies).values({ id: "old", name: "Ancien transporteur", nameAr: "-", code: "old", createdAt: T0, updatedAt: T0 });
    await d1.db.insert(schema.shipments).values({
      id: "s1", orderId: "o1", kind: "carrier", companyId: "old", handoffState: "accepted", carrierParcelId: "OLD-1", deliveryType: "home", codAmount: 5400,
      providerStatus: "En cours", revision: "r", createdAt: "2026-10-20 09:00:00", updatedAt: T0,
    });
    const row = await d1.db.get<{ s: string }>(sql`select ${shipmentSnapshot("s1").sql} as s`);
    const parsed = shipmentSchema.safeParse(JSON.parse(row!.s));
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toMatchObject({
      carrier: { companyId: "old", name: "Ancien transporteur", provider: null },
      driver: null,
      providerStatus: { value: "En cours", label: null },
      codAmount: { amount: "5400.00" },
      handedOffAt: "2026-10-20T09:00:00.000Z",
      deliveredAt: null,
    });
  });
});
