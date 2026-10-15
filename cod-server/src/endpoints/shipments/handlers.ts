/**
 * Shipment handlers: handing orders to a carrier (one or many), reading a
 * shipment, resolving a handoff whose outcome was unknown, and the
 * operations on a shipment after its handoff (thin: the work is in
 * `operations.ts`).
 */

import type { Context } from "hono";
import { inArray } from "drizzle-orm";
import type { AppContext } from "@/types";
import { getDb, type AppDb } from "@/db";
import { shipments } from "@/db/schema";
import { NotFoundError } from "@/lib/errors/classes";
import { carrierCapabilities } from "@/carriers/registry";
import { getDeliveryCompanyRaw } from "../../../../cod-shared/queries/delivery-companies";
import { handOffToCarrier, resolveHandoff, type DeliveryCompanyRow, type HandoffResult } from "./carrier-handoff";
import { loadShipmentView, shipmentView, type ShipmentView } from "./view";
import type {
  bulkCarrierHandoffSchema,
  carrierHandoffSchema,
  merchantReportSchema,
  remarkSchema,
  resolveHandoffSchema,
  updateParcelSchema,
  validateShipmentSchema,
} from "./validation";
import * as operations from "./operations";
import type { RecordedEvents } from "../../../../cod-shared/shipments/record-events";
import type { z } from "@hono/zod-openapi";

async function companyOrThrow(db: AppDb, companyId: string): Promise<DeliveryCompanyRow> {
  const company = await getDeliveryCompanyRaw(db, companyId);
  if (!company) throw new NotFoundError("Delivery company", companyId);
  return company;
}

/** Results as the API shows them, each with its shipment when one exists. */
async function resultItems(db: AppDb, company: DeliveryCompanyRow, results: HandoffResult[]) {
  const ids = results.flatMap((r) => (r.outcome === "refused" ? [] : [r.shipmentId]));
  const rows = ids.length ? await db.select().from(shipments).where(inArray(shipments.id, ids)).all() : [];
  const capabilities = carrierCapabilities(company);
  const views = new Map<string, ShipmentView>(rows.map((row) => [row.id, shipmentView(row, capabilities)]));
  return results.map((r) => {
    switch (r.outcome) {
      case "accepted":
        return { orderId: r.orderId, orderNumber: r.orderNumber, outcome: r.outcome, shipment: views.get(r.shipmentId), validationError: r.validationError };
      case "unknown":
        return { orderId: r.orderId, orderNumber: r.orderNumber, outcome: r.outcome, shipment: views.get(r.shipmentId), message: r.message };
      case "refused":
        return {
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          outcome: r.outcome,
          error: { code: r.error.code, message: r.error.message, ...(r.error.context ? { context: r.error.context } : {}) },
        };
    }
  });
}

/**
 * POST /orders/{id}/shipment — hand one order to a carrier.
 * 201 accepted · 202 unknown (resolve it; never re-send) · an error when refused.
 */
export async function handOffOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const body = (c.req as any).valid("json") as z.infer<typeof carrierHandoffSchema>;
  const company = await companyOrThrow(db, body.companyId);

  const [result] = await handOffToCarrier(
    db,
    company,
    [{ orderId, deliveryType: body.deliveryType, stationCode: body.stationCode, weight: body.weight, fragile: body.fragile, remarks: body.remarks }],
    c.get("user") ?? null,
  );
  if (result.outcome === "refused") throw result.error;
  const [item] = await resultItems(db, company, [result]);
  return c.json({ success: true, data: item }, result.outcome === "accepted" ? 201 : 202);
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
  const items = await resultItems(db, company, results);
  const count = (outcome: HandoffResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  return c.json({ success: true, data: { results: items, summary: { accepted: count("accepted"), unknown: count("unknown"), refused: count("refused") } } }, 200);
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
  const { orderId } = await operations.voidShipmentOperation(db, shipmentIdOf(c), actorOf(c));
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
  return respondWithShipment(c, db, recordedSummary(recorded));
}

/** POST /shipments/{id}/sync */
export async function sync(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const recorded = await operations.syncOne(db, shipmentIdOf(c));
  return respondWithShipment(c, db, recordedSummary(recorded));
}

/** POST /shipments/{id}/events */
export async function report(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as z.infer<typeof merchantReportSchema>;
  const recorded = await operations.reportShipmentEvent(db, shipmentIdOf(c), body, c.get("user"));
  return respondWithShipment(c, db, recordedSummary(recorded));
}
