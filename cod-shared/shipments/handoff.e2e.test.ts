/**
 * The handoff protocol and shipment lookups on real D1.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import {
  acceptCarrierHandoff,
  discardReservation,
  handOffToDriver,
  markHandoffUnknown,
  markValidated,
  noteShipmentStep,
  recordParcelEdit,
  recordSynced,
  releaseUnknownHandoff,
  reserveCarrierShipment,
  voidShipment,
  type CarrierReservation,
} from "./handoff";
import { carrierRefOf, findCarrierShipment, getOrderShipment, getShipmentWithEvents } from "./queries";
import { recordShipmentEvents } from "./record-events";

let d1: TestD1;
const T0 = "2026-10-14T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  const db = d1.db;
  for (const table of [schema.shipmentEvents, schema.shipments, schema.orders, schema.customers, schema.driverCompensations, schema.drivers, schema.deliveryCompanies]) {
    await db.delete(table);
  }
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  const order = (id: string, status: "new" | "confirmed" | "ready" | "cancelled", wilayaId = 16) => ({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId, price: 1500, deliveryFee: 400, status, createdAt: T0, updatedAt: T0,
  });
  await db.insert(schema.orders).values([order("ready", "ready"), order("ready2", "ready", 31), order("new", "new"), order("confirmed", "confirmed"), order("cancelled", "cancelled")]);
  await db.insert(schema.deliveryCompanies).values([
    { id: "co1", name: "Yalidine", nameAr: "ياليدين", code: "yalidine", provider: "yalidine", createdAt: T0, updatedAt: T0 },
    { id: "co2", name: "ZR", nameAr: "زد آر", code: "zr_express", provider: "zr_express", createdAt: T0, updatedAt: T0 },
  ]);
  await db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.driverCompensations).values({ id: "comp1", driverId: "dr1", wilayaId: 16, feePerDelivery: 350, createdAt: T0, updatedAt: T0 });
});

const reservation = (over: Partial<CarrierReservation> = {}): CarrierReservation => ({
  orderId: "ready", companyId: "co1", deliveryType: "home", stationCode: null, weight: 2, isFragile: true, createdBy: "u1", ...over,
});
const shipmentOf = (orderId: string) => getOrderShipment(d1.db, orderId);
const steps = async (shipmentId: string) => (await getShipmentWithEvents(d1.db, shipmentId))!.events.map((e) => [e.source, e.providerStatus]);
const parcel = { carrierParcelId: "yal-1", trackingNumber: "yal-1", carrierData: { label: "https://l" }, labelUrl: "https://l" };

describe("reserving a carrier shipment", () => {
  it("reserves a ready order, with the cash to collect read from the order", async () => {
    const reserved = await reserveCarrierShipment(d1.db, reservation());
    expect(reserved.ok).toBe(true);
    expect(await shipmentOf("ready")).toMatchObject({ kind: "carrier", companyId: "co1", handoffState: "submitting", codAmount: 1900, weight: 2, isFragile: true, createdBy: "u1", carrierParcelId: null });
  });

  it.each([["new"], ["confirmed"], ["cancelled"]])("refuses a %s order and writes nothing", async (orderId) => {
    expect(await reserveCarrierShipment(d1.db, reservation({ orderId }))).toEqual({ ok: false, reason: "order_not_ready" });
    expect(await shipmentOf(orderId)).toBeUndefined();
  });

  it("refuses an order that does not exist, and an order that already has a shipment", async () => {
    expect(await reserveCarrierShipment(d1.db, reservation({ orderId: "nope" }))).toEqual({ ok: false, reason: "order_not_found" });
    await reserveCarrierShipment(d1.db, reservation());
    expect(await reserveCarrierShipment(d1.db, reservation({ companyId: "co2" }))).toEqual({ ok: false, reason: "order_has_shipment" });
  });

  it("five clicks at once send the order once", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveCarrierShipment(d1.db, reservation())));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "order_has_shipment")).toBe(true);
  });
});

describe("settling a carrier handoff", () => {
  const reserve = async () => {
    const r = await reserveCarrierShipment(d1.db, reservation());
    if (!r.ok) throw new Error("reservation failed");
    return r.shipmentId;
  };
  const reserve2 = async () => {
    const r = await reserveCarrierShipment(d1.db, reservation({ orderId: "ready2" }));
    if (!r.ok) throw new Error("reservation failed");
    return r.shipmentId;
  };

  it("accepted: the carrier's identity is recorded with the step", async () => {
    const id = await reserve();
    expect(await acceptCarrierHandoff(d1.db, id, parcel, { validated: false, actorId: "u1" })).toBe(true);
    expect(await shipmentOf("ready")).toMatchObject({ handoffState: "accepted", carrierParcelId: "yal-1", trackingNumber: "yal-1", labelUrl: "https://l", validatedAt: null });
    expect(await steps(id)).toEqual([["handoff", "created"]]);
    expect(await acceptCarrierHandoff(d1.db, id, parcel, { validated: false })).toBe(false);
  });

  it("accepted and validated at once", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: true });
    expect((await shipmentOf("ready"))!.validatedAt).not.toBeNull();
    expect(await steps(id)).toEqual([["handoff", "created_and_validated"]]);
  });

  it("refused: the reservation goes and the order can be sent again", async () => {
    const id = await reserve();
    expect(await discardReservation(d1.db, id)).toBe(true);
    expect(await shipmentOf("ready")).toBeUndefined();
    expect((await reserveCarrierShipment(d1.db, reservation())).ok).toBe(true);
  });

  it("an accepted shipment is never discarded", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: false });
    expect(await discardReservation(d1.db, id)).toBe(false);
    expect(await shipmentOf("ready")).toBeDefined();
  });

  it("unknown: kept reserved with the reason, and can still be accepted once found", async () => {
    const id = await reserve();
    expect(await markHandoffUnknown(d1.db, id, "Yalidine POST /parcels/ timed out")).toBe(true);
    expect((await shipmentOf("ready"))!.handoffState).toBe("unknown");
    expect(await discardReservation(d1.db, id)).toBe(false);
    expect(await acceptCarrierHandoff(d1.db, id, parcel, { validated: false, source: "system" })).toBe(true);
    const history = (await getShipmentWithEvents(d1.db, id))!.events;
    expect(history.map((e) => [e.source, e.providerStatus, e.reason])).toEqual([
      ["system", "handoff_outcome_unknown", "Yalidine POST /parcels/ timed out"],
      ["system", "created", null],
    ]);
  });

  it("only a reservation can become unknown — never a parcel the carrier accepted", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: false });
    expect(await markHandoffUnknown(d1.db, id, "late timeout")).toBe(false);
    expect((await shipmentOf("ready"))!.handoffState).toBe("accepted");
  });

  it("validated later, once", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: false });
    expect(await markValidated(d1.db, id, "u1")).toBe(true);
    expect(await markValidated(d1.db, id, "u1")).toBe(false);
    expect((await steps(id)).map(([, s]) => s)).toEqual(["created", "validated"]);
  });

  it("a CodFlow step never changes the carrier's status", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: true });
    expect((await shipmentOf("ready"))!.providerStatus).toBeNull();
  });

  it("released: only a handoff still unknown — never one found or attached meanwhile", async () => {
    const id = await reserve();
    expect(await releaseUnknownHandoff(d1.db, id)).toBe(false);
    await markHandoffUnknown(d1.db, id, "timeout");
    const accepted = await reserve2();
    await acceptCarrierHandoff(d1.db, accepted, { ...parcel, carrierParcelId: "yal-2", trackingNumber: "yal-2" }, { validated: false });
    expect(await releaseUnknownHandoff(d1.db, accepted)).toBe(false);
    expect(await shipmentOf("ready2")).toBeDefined();
    expect(await releaseUnknownHandoff(d1.db, id)).toBe(true);
    expect(await shipmentOf("ready")).toBeUndefined();
  });

  it("a parcel edit is recorded only on a shipment the carrier accepted", async () => {
    const id = await reserve();
    await markHandoffUnknown(d1.db, id, "timeout");
    expect(await recordParcelEdit(d1.db, id, { codAmount: 9 }, { fields: ["amount"], actorId: "u1" })).toBe(false);
    expect((await shipmentOf("ready"))!.codAmount).toBe(1900);

    await acceptCarrierHandoff(d1.db, id, parcel, { validated: false });
    const before = (await shipmentOf("ready"))!.revision;
    expect(await recordParcelEdit(d1.db, id, { codAmount: 2500, isFragile: false }, { fields: ["amount", "fragile"], actorId: "u1" })).toBe(true);
    const after = await shipmentOf("ready");
    expect(after).toMatchObject({ codAmount: 2500, isFragile: false, weight: 2 });
    expect(after!.revision).not.toBe(before);
    expect((await getShipmentWithEvents(d1.db, id))!.events.at(-1)).toMatchObject({ source: "merchant", providerStatus: "parcel_updated", reason: "amount, fragile", actorId: "u1" });
  });

  it("a sync stamps the time and adopts a tracking number the carrier assigned late — never replacing one", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, { ...parcel, trackingNumber: null }, { validated: false });
    await recordSynced(d1.db, id, null);
    expect(await shipmentOf("ready")).toMatchObject({ trackingNumber: null, lastSyncedAt: expect.any(String) });
    await recordSynced(d1.db, id, "ZR-LATE-1");
    expect((await shipmentOf("ready"))!.trackingNumber).toBe("ZR-LATE-1");
    await recordSynced(d1.db, id, "ZR-OTHER");
    expect((await shipmentOf("ready"))!.trackingNumber).toBe("ZR-LATE-1");
  });

  it("a note keeps a step in the history without touching the shipment; the same step at the same instant is one note", async () => {
    const id = await reserve();
    await acceptCarrierHandoff(d1.db, id, parcel, { validated: false });
    const before = await shipmentOf("ready");
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    try {
      expect(await noteShipmentStep(d1.db, id, "validation_failed", { source: "handoff", reason: "refused", actorId: "u1" })).toBe(true);
      expect(await noteShipmentStep(d1.db, id, "validation_failed", { source: "handoff", reason: "refused", actorId: "u1" })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const after = await shipmentOf("ready");
    expect(after!.revision).toBe(before!.revision);
    const events = (await getShipmentWithEvents(d1.db, id))!.events;
    expect(events.map((e) => [e.source, e.providerStatus, e.reason, e.actorId])).toEqual([
      ["handoff", "created", null, null],
      ["handoff", "validation_failed", "refused", "u1"],
    ]);
    expect(await noteShipmentStep(d1.db, "no-such-shipment", "x")).toBe(false);
  });
});

describe("handing off to the store's driver", () => {
  it("is accepted at once, with the driver's fee for the order's wilaya frozen", async () => {
    const r = await handOffToDriver(d1.db, { orderId: "ready", driverId: "dr1", deliveryType: "home", stationCode: null, createdBy: "u1" });
    expect(r.ok).toBe(true);
    expect(await shipmentOf("ready")).toMatchObject({ kind: "driver", driverId: "dr1", handoffState: "accepted", driverFee: 350, codAmount: 1900 });
    expect(await steps(r.ok ? r.shipmentId : "")).toEqual([["handoff", "assigned_to_driver"]]);

    await d1.db.update(schema.driverCompensations).set({ feePerDelivery: 999 });
    expect((await shipmentOf("ready"))!.driverFee).toBe(350);
  });

  it("pays nothing where the driver has no fee set", async () => {
    await handOffToDriver(d1.db, { orderId: "ready2", driverId: "dr1", deliveryType: "home", stationCode: null, createdBy: null });
    expect((await shipmentOf("ready2"))!.driverFee).toBe(0);
  });

  it("refuses an order that is not ready", async () => {
    expect(await handOffToDriver(d1.db, { orderId: "confirmed", driverId: "dr1", deliveryType: "home", stationCode: null, createdBy: null })).toEqual({ ok: false, reason: "order_not_ready" });
  });
});

describe("voiding", () => {
  const accepted = async () => {
    const r = await reserveCarrierShipment(d1.db, reservation());
    if (!r.ok) throw new Error();
    await acceptCarrierHandoff(d1.db, r.shipmentId, parcel, { validated: false });
    return r.shipmentId;
  };
  const report = (id: string, value: string, interpretation: Parameters<typeof recordShipmentEvents>[2][number]["interpretation"], minute: number) =>
    recordShipmentEvents(d1.db, id, [{ source: "webhook", status: { vocabulary: "status", value }, interpretation, occurredAt: new Date(Date.parse(T0) + minute * 60_000).toISOString() }]);

  it("removes a shipment that never left, with its history; the order can be sent again", async () => {
    const id = await accepted();
    expect(await voidShipment(d1.db, id)).toEqual({ ok: true, orderId: "ready" });
    expect(await shipmentOf("ready")).toBeUndefined();
    expect(await d1.db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, id)).all()).toEqual([]);
    expect((await reserveCarrierShipment(d1.db, reservation())).ok).toBe(true);
  });

  it("releases a handoff whose outcome is unknown, and a shipment the carrier cancelled", async () => {
    const r = await reserveCarrierShipment(d1.db, reservation());
    if (!r.ok) throw new Error();
    await markHandoffUnknown(d1.db, r.shipmentId, "timeout");
    expect((await voidShipment(d1.db, r.shipmentId)).ok).toBe(true);

    const id = await accepted();
    await report(id, "Annulé", { kind: "milestone", milestone: "cancelled" }, 5);
    expect((await voidShipment(d1.db, id)).ok).toBe(true);
  });

  it("refuses once the parcel is in the final mile, coming back, or closed", async () => {
    const id = await accepted();
    await report(id, "Sorti en livraison", { kind: "milestone", milestone: "out_for_delivery" }, 5);
    expect(await voidShipment(d1.db, id)).toEqual({ ok: false, code: "SHIPMENT_NOT_VOIDABLE" });
    await report(id, "Livré", { kind: "milestone", milestone: "delivered" }, 10);
    expect(await voidShipment(d1.db, id)).toEqual({ ok: false, code: "SHIPMENT_CLOSED" });
    expect(await shipmentOf("ready")).toBeDefined();
    expect(await voidShipment(d1.db, "nope")).toEqual({ ok: false, code: "SHIPMENT_NOT_FOUND" });
  });

  it("a delivery recorded between the void's check and its delete stops the void", async () => {
    const id = await accepted();
    let fired = false;
    // The database as the void sees it: the first row it reads is answered,
    // then a delivery is recorded before the void can act on what it read.
    const wrap = (target: object): unknown =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          const member = Reflect.get(obj, prop, receiver);
          if (typeof member !== "function") return member;
          if (prop === "get") {
            return async (...args: unknown[]) => {
              const row = await member.apply(obj, args);
              if (!fired) {
                fired = true;
                await report(id, "Livré", { kind: "milestone", milestone: "delivered" }, 10);
              }
              return row;
            };
          }
          return (...args: unknown[]) => {
            const result = member.apply(obj, args);
            return result && typeof result === "object" && prop !== "batch" ? wrap(result) : result;
          };
        },
      });
    const outcome = await voidShipment(wrap(d1.db) as typeof d1.db, id);
    expect(outcome).toEqual({ ok: false, code: "SHIPMENT_CLOSED" });
    expect((await shipmentOf("ready"))!.deliveredAt).not.toBeNull();
  });

  it("a void racing a delivery never erases a delivered parcel", async () => {
    for (let round = 0; round < 5; round++) {
      await d1.db.delete(schema.shipments);
      const id = await accepted();
      const outcomes = await Promise.allSettled([
        voidShipment(d1.db, id),
        report(id, "Livré", { kind: "milestone", milestone: "delivered" }, 10),
      ]);
      const row = await shipmentOf("ready");
      const voided = outcomes[0].status === "fulfilled" && outcomes[0].value.ok;
      if (voided) expect(row).toBeUndefined();
      else expect(row?.deliveredAt).not.toBeNull();
    }
  });
});

describe("finding the shipment an update is about", () => {
  it("by the carrier's parcel id, then tracking number, then our order number — at that company only", async () => {
    const r = await reserveCarrierShipment(d1.db, reservation());
    if (!r.ok) throw new Error();
    await acceptCarrierHandoff(d1.db, r.shipmentId, { ...parcel, carrierParcelId: "uuid-9", trackingNumber: "16-AB-ZR" }, { validated: false });
    for (const match of [{ carrierParcelId: "uuid-9" }, { trackingNumber: "16-AB-ZR" }, { reference: "ORD-ready" }, { carrierParcelId: "old", trackingNumber: "16-AB-ZR" }]) {
      expect((await findCarrierShipment(d1.db, "co1", match))?.id).toBe(r.shipmentId);
    }
    expect(await findCarrierShipment(d1.db, "co2", { carrierParcelId: "uuid-9" })).toBeNull();
    expect(await findCarrierShipment(d1.db, "co1", { trackingNumber: "nope", reference: "ORD-nope" })).toBeNull();
  });

  it("gives an adapter the parcel's identity and its own data back", async () => {
    const r = await reserveCarrierShipment(d1.db, reservation());
    if (!r.ok) throw new Error();
    expect(carrierRefOf((await shipmentOf("ready"))!)).toBeNull();
    await acceptCarrierHandoff(d1.db, r.shipmentId, parcel, { validated: false });
    expect(carrierRefOf((await shipmentOf("ready"))!)).toEqual({ carrierParcelId: "yal-1", trackingNumber: "yal-1", carrierData: { label: "https://l" } });
  });
});
