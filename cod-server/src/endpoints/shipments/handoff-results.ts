/**
 * A handoff as the API and the AI tools answer it: one order handed to a
 * carrier or to the store's driver, and each result with its shipment when
 * one exists.
 */

import { inArray } from "drizzle-orm";
import type { z } from "@hono/zod-openapi";
import type { AppDb } from "@/db";
import { shipments } from "@/db/schema";
import type { StaffActor } from "@/types";
import type { Acting } from "@/lib/acting";
import { NotFoundError } from "@/lib/errors/classes";
import { carrierCapabilities } from "@/carriers/registry";
import { getDeliveryCompanyRaw } from "../../../../cod-shared/queries/delivery-companies";
import { handOffToCarrier, type DeliveryCompanyRow, type HandoffResult } from "./carrier-handoff";
import { driverFor, handOffToDriverOrders, type DriverHandoffResult } from "./driver-handoff";
import { requireKindScope } from "./guard";
import { shipmentView, type ShipmentCarrier, type ShipmentView } from "./view";
import type { orderHandoffSchema } from "./validation";

export type AnyHandoffResult = HandoffResult | DriverHandoffResult;

export async function companyOrThrow(db: AppDb, companyId: string): Promise<DeliveryCompanyRow> {
  const company = await getDeliveryCompanyRaw(db, companyId);
  if (!company) throw new NotFoundError("Delivery company", companyId);
  return company;
}

/** A company as the carrier of the shipments handed to it. */
export const carrierOf = (company: DeliveryCompanyRow): ShipmentCarrier => ({ name: company.name, capabilities: carrierCapabilities(company) });

/** Results as the API shows them, each with its shipment when one exists. */
export async function resultItems(db: AppDb, carrier: ShipmentCarrier | null, results: readonly AnyHandoffResult[]) {
  const ids = results.flatMap((r) => (r.outcome === "refused" ? [] : [r.shipmentId]));
  const rows = ids.length ? await db.select().from(shipments).where(inArray(shipments.id, ids)).all() : [];
  const views = new Map<string, ShipmentView>(rows.map((row) => [row.id, shipmentView(row, carrier)]));
  return results.map((r) => {
    switch (r.outcome) {
      case "accepted":
        return {
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          outcome: r.outcome,
          shipment: views.get(r.shipmentId),
          ...("validationError" in r ? { validationError: r.validationError } : {}),
        };
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

export type HandoffItem = Awaited<ReturnType<typeof resultItems>>[number];

export function bulkData(items: readonly HandoffItem[], results: readonly AnyHandoffResult[]) {
  const count = (outcome: AnyHandoffResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  return { results: items, summary: { accepted: count("accepted"), unknown: count("unknown"), refused: count("refused") } };
}

/**
 * Hand one order off, with the permission its kind takes: accepted, or
 * unknown (a carrier's — resolve it, never send it again); a refusal throws.
 */
export async function handOffOne(db: AppDb, orderId: string, request: z.infer<typeof orderHandoffSchema>, acting: Acting & { staff: StaffActor }): Promise<Exclude<HandoffItem, { outcome: "refused" }>> {
  requireKindScope(acting.staff, request.kind, "Creating");

  if (request.kind === "driver") {
    const driver = await driverFor(db, request.driverId);
    const [result] = await handOffToDriverOrders(db, driver, [{ orderId }], acting);
    if (result.outcome === "refused") throw result.error;
    const [item] = await resultItems(db, null, [result]);
    return item as Exclude<HandoffItem, { outcome: "refused" }>;
  }

  const company = await companyOrThrow(db, request.companyId);
  const [result] = await handOffToCarrier(
    db,
    company,
    [{ orderId, deliveryType: request.deliveryType, stationCode: request.stationCode, weight: request.weight, fragile: request.fragile, remarks: request.remarks }],
    acting,
  );
  if (result.outcome === "refused") throw result.error;
  const [item] = await resultItems(db, carrierOf(company), [result]);
  return item as Exclude<HandoffItem, { outcome: "refused" }>;
}
