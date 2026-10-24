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
import { sampleOrder, sampleShipment } from "@/test-utils/events";
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

const order = sampleOrder;
const shipment = sampleShipment;
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
