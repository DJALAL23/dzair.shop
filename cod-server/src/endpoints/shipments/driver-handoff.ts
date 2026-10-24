/**
 * Handing orders to the store's own driver — the one path, for one order or
 * a hundred (ADR 0006). There is no carrier to call: each order's shipment
 * is accepted at once, with the driver's fee for its wilaya frozen, in one
 * statement that also checks the order is ready with no shipment and a
 * street address, and the driver still takes orders. The driver is not a
 * carrier: the parcel goes to the customer's door, never to a stop desk,
 * even when the customer chose one (the order keeps that choice and its
 * price). The driver's progress is then reported by the merchant
 * (`POST /shipments/{id}/events`).
 *
 * A hundred orders take the same few trips to D1 as one: their order
 * numbers in one read, every shipment in one batch, the refusals' reasons
 * in one read, and the activity log in one batch.
 */

import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { drivers, orders } from "@/db/schema";
import { AppError, BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ACTIONS, logActivities } from "@/lib/activity";
import type { Actor } from "@/types";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { chunkIds } from "../../../../cod-shared/queries/d1-limits";
import { handOffToDriver, type ReservationRefusal } from "../../../../cod-shared/shipments/handoff";

export interface DriverHandoffRequest {
  orderId: string;
}

export type DriverHandoffResult =
  | { orderId: string; orderNumber: string; outcome: "accepted"; shipmentId: string }
  | { orderId: string; orderNumber: string | null; outcome: "refused"; error: AppError };

type DriverRow = typeof drivers.$inferSelect;
type OrderFacts = { id: string; orderNumber: string; status: string };

/** The driver, or the reason they cannot take orders — which refuses the whole handoff. */
export async function driverFor(db: AppDb, driverId: string): Promise<DriverRow> {
  const driver = await db.select().from(drivers).where(eq(drivers.id, driverId)).get();
  if (!driver) throw new NotFoundError("Driver", driverId);
  if (driver.status === "inactive") {
    throw new BusinessLogicError(`${driver.firstName} ${driver.lastName} is inactive and takes no orders`, ERROR_CODES.DRIVER_UNAVAILABLE, { driverId });
  }
  return driver;
}

function refusal(reason: ReservationRefusal, order: OrderFacts, driverId: string): AppError {
  const context = { orderId: order.id, orderNumber: order.orderNumber };
  switch (reason) {
    case "order_not_found":
      return new NotFoundError("Order", order.id);
    case "order_has_shipment":
      return new ConflictError(`Order ${order.orderNumber} already has a shipment`, ERROR_CODES.ORDER_HAS_SHIPMENT, context);
    case "order_not_ready":
      return new BusinessLogicError(`Order ${order.orderNumber} is "${order.status}"; only a ready order can be handed off`, ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF, { ...context, status: order.status });
    case "order_missing_address":
      return new ValidationError(`Order ${order.orderNumber} has no street address; the driver delivers to the customer's door`, ERROR_CODES.MISSING_ADDRESS, context);
    case "driver_unavailable":
      return new BusinessLogicError("The driver no longer takes orders", ERROR_CODES.DRIVER_UNAVAILABLE, { ...context, driverId });
  }
}

/** The orders' numbers and statuses, read in one trip. */
async function orderFacts(db: AppDb, orderIds: readonly string[]): Promise<Map<string, OrderFacts>> {
  const chunks = chunkIds([...new Set(orderIds)]);
  if (chunks.length === 0) return new Map();
  const reads = chunks.map((chunk) => db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status }).from(orders).where(inArray(orders.id, chunk)));
  const rows = (await db.batch(reads as [(typeof reads)[number], ...typeof reads])) as OrderFacts[][];
  return new Map(rows.flat().map((row) => [row.id, row]));
}

/** Hand each order to the driver; one result per order, in the order asked. */
export async function handOffToDriverOrders(
  db: AppDb,
  driver: DriverRow,
  requests: readonly DriverHandoffRequest[],
  actor: Actor | null,
): Promise<DriverHandoffResult[]> {
  const orderIds = requests.map((request) => request.orderId);
  const facts = await orderFacts(db, orderIds);
  const handed = await handOffToDriver(db, { orderIds, driverId: driver.id, createdBy: actor?.id ?? null });

  const results = handed.map((outcome, i): DriverHandoffResult => {
    const orderId = orderIds[i];
    const order = facts.get(orderId);
    if (!order) return { orderId, orderNumber: null, outcome: "refused", error: new NotFoundError("Order", orderId) };
    if (outcome.ok) return { orderId, orderNumber: order.orderNumber, outcome: "accepted", shipmentId: outcome.shipmentId };
    return { orderId, orderNumber: order.orderNumber, outcome: "refused", error: refusal(outcome.reason, order, driver.id) };
  });

  if (actor) {
    await logActivities(
      db,
      actor,
      ACTIONS.ORDER_DRIVER_ASSIGNED,
      results.flatMap((r) =>
        r.outcome === "accepted" ? [{ entity: { type: "order", id: r.orderId, label: r.orderNumber }, metadata: { driverId: driver.id, shipmentId: r.shipmentId } }] : [],
      ),
    );
  }
  return results;
}
