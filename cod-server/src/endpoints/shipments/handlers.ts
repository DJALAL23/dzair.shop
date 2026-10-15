/**
 * Shipment handlers: handing orders to a carrier or to the store's driver
 * (one or many), reading a shipment, resolving a handoff whose outcome was
 * unknown, and the operations on a shipment after its handoff (thin: the
 * work is in `carrier-handoff.ts`, `driver-handoff.ts` and `operations.ts`).
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb, type AppDb } from "@/db";
import { handOffToCarrier, resolveHandoff } from "./carrier-handoff";
import { driverFor, handOffToDriverOrders } from "./driver-handoff";
import { bulkData, carrierOf, companyOrThrow, handOffOne, resultItems } from "./handoff-results";
import { loadShipmentView } from "./view";
import type {
  bulkCarrierHandoffSchema,
  bulkDriverHandoffSchema,
  orderHandoffSchema,
  merchantReportSchema,
  remarkSchema,
  resolveHandoffSchema,
  updateParcelSchema,
  validateShipmentSchema,
} from "./validation";
import * as operations from "./operations";
import { scheduleShipmentConversions } from "@/lib/conversions";
import type { RecordedEvents } from "../../../../cod-shared/shipments/record-events";
import type { z } from "@hono/zod-openapi";

/**
 * POST /orders/{id}/shipment — hand one order to a carrier or to the store's driver.
 * 201 accepted · 202 unknown (a carrier's; resolve it, never re-send) · an error when refused.
 */
export async function handOffOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as z.infer<typeof orderHandoffSchema>;
  const item = await handOffOne(db, c.req.param("id")!, body, c.get("user"));
  return c.json({ success: true, data: item }, item.outcome === "accepted" ? 201 : 202);
}

/** POST /shipments/bulk — hand many orders to one carrier; one result per order. */
export async function handOffBulk(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as z.infer<typeof bulkCarrierHandoffSchema>;
  const company = await companyOrThrow(db, body.companyId);

  const results = await handOffToCarrier(
    db,
    company,
    body.orderIds.map((orderId) => ({ orderId, deliveryType: body.deliveryType })),
    c.get("user") ?? null,
  );
  return c.json({ success: true, data: bulkData(await resultItems(db, carrierOf(company), results), results) }, 200);
}

/** POST /shipments/driver-bulk — give many orders to one driver; one result per order. */
export async function handOffDriverBulk(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as z.infer<typeof bulkDriverHandoffSchema>;
  const driver = await driverFor(db, body.driverId);
  const results = await handOffToDriverOrders(db, driver, body.orderIds.map((orderId) => ({ orderId, deliveryType: body.deliveryType })), c.get("user"));
  return c.json({ success: true, data: bulkData(await resultItems(db, null, results), results) }, 200);
}

/** GET /shipments/{id} — the shipment with its history and what can be done now. */
export async function getShipmentDetail(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await loadShipmentView(db, c.req.param("id")!, { events: true }) }, 200);
}

/** POST /shipments/{id}/resolve — settle a handoff whose outcome was unknown. */
export async function resolveShipmentHandoff(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const shipmentId = c.req.param("id")!;
  const body = (c.req as any).valid("json") as z.infer<typeof resolveHandoffSchema>;
  const resolved = await resolveHandoff(db, shipmentId, body, c.get("user") ?? null);

  switch (resolved.outcome) {
    case "released":
    case "not_found":
      return c.json({ success: true, data: { outcome: resolved.outcome } }, 200);
    case "accepted": {
      const shipment = await loadShipmentView(db, shipmentId, { events: false });
      const message = resolved.result.outcome === "unknown" ? resolved.result.message : undefined;
      return c.json({ success: true, data: { outcome: resolved.result.outcome, shipment, ...(message ? { message } : {}) } }, 200);
    }
  }
}

// ─── Operations on a shipment ─────────────────────────────────────────────────

const shipmentIdOf = (c: Context<AppContext>) => c.req.param("id")!;
const actorOf = (c: Context<AppContext>) => c.get("user") ?? null;

async function respondWithShipment(c: Context<AppContext>, db: AppDb, extra: Record<string, unknown> = {}) {
  const shipment = await loadShipmentView(db, shipmentIdOf(c), { events: false });
  return c.json({ success: true, data: { shipment, ...extra } }, 200);
}

const recordedSummary = (r: RecordedEvents) => ({ recorded: r.recorded, duplicates: r.duplicates, reached: r.reached, anomalies: r.anomalies });

/** The conversions newly reached milestones call for — scheduled after the answer is ready, never blocking it. */
async function scheduleConversions(c: Context<AppContext>, db: AppDb, recorded: RecordedEvents) {
  await scheduleShipmentConversions(c.env, (p) => c.executionCtx.waitUntil(p), db, recorded.businessEvents);
}

/** POST /shipments/{id}/validate */
export async function validate(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = ((c.req as any).valid("json") ?? {}) as z.infer<typeof validateShipmentSchema>;
  await operations.validateShipment(db, shipmentIdOf(c), body, actorOf(c));
  return respondWithShipment(c, db);
}

/** PATCH /shipments/{id} */
export async function update(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  await operations.updateParcel(db, shipmentIdOf(c), (c.req as any).valid("json") as z.infer<typeof updateParcelSchema>, actorOf(c));
  return respondWithShipment(c, db);
}

/** POST /shipments/{id}/void */
export async function voidOne(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { orderId } = await operations.voidShipmentOperation(db, shipmentIdOf(c), c.get("user"));
  return c.json({ success: true, data: { orderId } }, 200);
}

/** GET /shipments/{id}/remarks */
export async function remarks(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await operations.listRemarks(db, shipmentIdOf(c)) }, 200);
}

/** POST /shipments/{id}/remarks */
export async function addRemark(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { content } = (c.req as any).valid("json") as z.infer<typeof remarkSchema>;
  await operations.addRemark(db, shipmentIdOf(c), content, actorOf(c));
  return respondWithShipment(c, db);
}

/** GET /shipments/{id}/label */
export async function label(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const file = await operations.shipmentLabel(db, shipmentIdOf(c));
  return new Response(file.body, {
    status: 200,
    headers: { "Content-Type": file.contentType, "Content-Disposition": `inline; filename="${file.name}"`, "Cache-Control": "no-store" },
  });
}

/** POST /shipments/{id}/ask-return */
export async function askReturn(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  await operations.askReturn(db, shipmentIdOf(c), actorOf(c));
  return respondWithShipment(c, db);
}

/** POST /shipments/{id}/request-new-attempt */
export async function requestNewAttempt(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  await operations.requestNewAttempt(db, shipmentIdOf(c), actorOf(c));
  return respondWithShipment(c, db);
}

/** POST /shipments/{id}/confirm-return */
export async function confirmReturn(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const recorded = await operations.confirmReturn(db, shipmentIdOf(c), actorOf(c));
  await scheduleConversions(c, db, recorded);
  return respondWithShipment(c, db, recordedSummary(recorded));
}

/** POST /shipments/{id}/sync */
export async function sync(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const recorded = await operations.syncOne(db, shipmentIdOf(c));
  await scheduleConversions(c, db, recorded);
  return respondWithShipment(c, db, recordedSummary(recorded));
}

/** POST /shipments/{id}/events */
export async function report(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as z.infer<typeof merchantReportSchema>;
  const recorded = await operations.reportShipmentEvent(db, shipmentIdOf(c), body, c.get("user"));
  await scheduleConversions(c, db, recorded);
  return respondWithShipment(c, db, recordedSummary(recorded));
}
