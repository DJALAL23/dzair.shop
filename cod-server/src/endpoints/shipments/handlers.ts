/**
 * Shipment handlers: handing orders to a carrier (one or many), reading a
 * shipment, and resolving a handoff whose outcome was unknown.
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
import type { bulkCarrierHandoffSchema, carrierHandoffSchema, resolveHandoffSchema } from "./validation";
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
