/**
 * The Event Catalogue keeps its promises (ADR 0018):
 *   - every current version is released, and no released type disappears;
 *   - a current version never breaks its released snapshot;
 *   - the schemas consumers are promised are exactly the types writers build;
 *   - data writers build is accepted by its schema.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { EVENT_CATALOGUE, EVENT_TYPES, type EventDataMap, type EventType } from "../../../cod-shared/events/catalogue";
import { money } from "../../../cod-shared/events/money";
import type { OrderSnapshot, ShipmentSnapshot } from "../../../cod-shared/events/snapshots";
import { breakingChanges } from "./compatibility";
import { EVENT_DATA_SCHEMAS, eventDataJsonSchema, parseReleasedSnapshotName, releasedSnapshotName } from "./catalogue";

const RELEASED = resolve(import.meta.dirname, "released");
const released = readdirSync(RELEASED).map((file) => {
  const parsed = parseReleasedSnapshotName(file);
  if (!parsed) throw new Error(`${file} is not a released snapshot name (<type>.v<version>.json)`);
  return { file, ...parsed, schema: JSON.parse(readFileSync(resolve(RELEASED, file), "utf8")) as Record<string, unknown> };
});

describe("the Event Catalogue", () => {
  it("names every type subject.what, with the subject the catalogue gives it", () => {
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+\.[a-z]+(_[a-z]+)*$/);
      expect(type.split(".")[0]).toBe(EVENT_CATALOGUE[type].subject);
    }
  });

  it.each(EVENT_TYPES)("has released %s's current version", (type) => {
    const name = releasedSnapshotName(type, EVENT_CATALOGUE[type].version);
    expect(released.map((r) => r.file), `${name} is missing — run npm run events:release-catalogue`).toContain(name);
  });

  it.each(released.map((r) => [r.file, r] as const))("still publishes %s", (_, snapshot) => {
    expect(EVENT_TYPES, `${snapshot.type} was released and can never be removed`).toContain(snapshot.type);
    const current = EVENT_CATALOGUE[snapshot.type as EventType].version;
    expect(current, `${snapshot.type}'s version went backwards`).toBeGreaterThanOrEqual(snapshot.version);
    expect(current, `${snapshot.type} v${current} needs the renderer that keeps producing v${snapshot.version} before it can ship`).toBe(snapshot.version);
  });

  it.each(released.map((r) => [r.file, r] as const))("never breaks the released %s", (_, snapshot) => {
    expect(breakingChanges(snapshot.schema, eventDataJsonSchema(snapshot.type as EventType))).toEqual([]);
  });

  it("promises consumers exactly the data writers build", () => {
    expectTypeOf<{ [T in EventType]: z.output<(typeof EVENT_DATA_SCHEMAS)[T]> }>().toEqualTypeOf<EventDataMap>();
  });

  it.each(EVENT_TYPES)("accepts the data a writer builds for %s", (type) => {
    expect(EVENT_DATA_SCHEMAS[type].safeParse(SAMPLE[type]).error).toBeUndefined();
  });
});

const order: OrderSnapshot = {
  id: "0b7e4c1a-2f7d-4a52-9d1e-1f3c5a9b7e21",
  number: "ORD-20261025-0001",
  status: "confirmed",
  type: "online",
  placedAt: "2026-10-25T09:14:03.120Z",
  customer: { id: "c-1", name: "Amina B.", phone: "0551234567", email: null },
  destination: {
    wilaya: { id: 16, name: "Alger", nameAr: "الجزائر" },
    commune: { id: "16001", name: "Alger Centre", nameAr: "الجزائر الوسطى" },
    city: null,
    address: "12 rue Didouche Mourad",
    deliveryType: "home",
    stationCode: null,
  },
  lines: [
    {
      id: "l-1",
      productId: "p-1",
      variantId: null,
      name: "Robe",
      variantLabel: "Rouge / M",
      sku: "RB-R-M",
      quantity: 2,
      unitPrice: money(2500),
      discount: money(200),
      total: money(4800),
      gift: false,
      offer: null,
      returnedQuantity: 0,
    },
    {
      id: "l-2",
      productId: null,
      variantId: null,
      name: "Foulard",
      variantLabel: null,
      sku: null,
      quantity: 1,
      unitPrice: money(0),
      discount: money(0),
      total: money(0),
      gift: true,
      offer: { id: null, name: "Un foulard offert" },
      returnedQuantity: 0,
    },
  ],
  subtotal: money(4800),
  deliveryFee: money(400),
  total: money(5200),
  coupon: { code: "AID10", discount: money(200) },
  freeDeliveryOffer: null,
  notes: null,
  customFields: [{ id: "f-1", label: "Taille", type: "select", value: "M" }],
};

const shipment: ShipmentSnapshot = {
  id: "s-1",
  kind: "carrier",
  carrier: { companyId: "dc-1", name: "Yalidine", provider: "yalidine" },
  driver: null,
  trackingNumber: "yal-ABC123",
  deliveryType: "home",
  stationCode: null,
  codAmount: money(5200),
  providerStatus: { value: "Sorti en livraison", label: null },
  handedOffAt: "2026-10-25T11:00:00.000Z",
  outForDeliveryAt: "2026-10-26T08:30:00.000Z",
  deliveredAt: null,
  returnStartedAt: null,
  returnedAt: null,
  cancelledAt: null,
  deliveryAttempts: 0,
};

const report = { shipment, order, reason: null };

const SAMPLE: EventDataMap = {
  "order.created": { order: { ...order, status: "new" } },
  "order.updated": { order, changedFields: ["customerPhone", "destination"] },
  "order.confirmed": { order, previousStatus: "new" },
  "order.unreachable": { order: { ...order, status: "unreachable" }, previousStatus: "new" },
  "order.preparing": { order: { ...order, status: "preparing" }, previousStatus: "confirmed" },
  "order.ready": { order: { ...order, status: "ready" }, previousStatus: "preparing" },
  "order.cancelled": { order: { ...order, status: "cancelled" }, previousStatus: "confirmed" },
  "order.line_returned": { order, lineId: "l-1", previousReturnedQuantity: 0 },
  "order.deleted": { order },
  "shipment.handed_off": { shipment: { ...shipment, outForDeliveryAt: null, providerStatus: null }, order },
  "shipment.out_for_delivery": report,
  "shipment.delivery_failed": { ...report, reason: "Client injoignable", attempt: 1 },
  "shipment.delivered": { ...report, shipment: { ...shipment, deliveredAt: "2026-10-26T14:02:00.000Z" } },
  "shipment.return_started": report,
  "shipment.returned": report,
  "shipment.cancelled": report,
  "shipment.voided": { shipment, order },
};
