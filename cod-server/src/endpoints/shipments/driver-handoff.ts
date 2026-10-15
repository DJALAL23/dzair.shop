/**
 * Handing orders to the store's own driver — the one path, for one order or
 * a hundred (ADR 0006). There is no carrier to call: each order's shipment
 * is accepted at once, with the driver's fee for its wilaya frozen, in one
 * statement that also checks the order is ready with no shipment and the
 * driver still takes orders. The driver's progress is then reported by the
 * merchant (`POST /shipments/{id}/events`).
 */

import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { drivers, orders } from "@/db/schema";
import { AppError, BusinessLogicError, ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import type { Actor } from "@/types";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { handOffToDriver, type ReservationRefusal } from "../../../../cod-shared/shipments/handoff";

type DeliveryType = "home" | "stop_desk";

export interface DriverHandoffRequest {
  orderId: string;
  /** Instead of what the customer asked for; the cash to collect does not change. */
  deliveryType?: DeliveryType;
  stationCode?: string;
}

export type DriverHandoffResult =
  | { orderId: string; orderNumber: string; outcome: "accepted"; shipmentId: string }
  | { orderId: string; orderNumber: string | null; outcome: "refused"; error: AppError };

type DriverRow = typeof drivers.$inferSelect;

/** The driver, or the reason they cannot take orders — which refuses the whole handoff. */
export async function driverFor(db: AppDb, driverId: string): Promise<DriverRow> {
  const driver = await db.select().from(drivers).where(eq(drivers.id, driverId)).get();
  if (!driver) throw new NotFoundError("Driver", driverId);
  if (driver.status === "inactive") {
    throw new BusinessLogicError(`${driver.firstName} ${driver.lastName} is inactive and takes no orders`, ERROR_CODES.DRIVER_UNAVAILABLE, { driverId });
  }
  return driver;
}

function refusal(reason: ReservationRefusal, order: { id: string; orderNumber: string; status: string }, driverId: string): AppError {
  const context = { orderId: order.id, orderNumber: order.orderNumber };
  switch (reason) {
    case "order_not_found":
      return new NotFoundError("Order", order.id);
    case "order_has_shipment":
      return new ConflictError(`Order ${order.orderNumber} already has a shipment`, ERROR_CODES.ORDER_HAS_SHIPMENT, context);
    case "order_not_ready":
      return new BusinessLogicError(`Order ${order.orderNumber} is "${order.status}"; only a ready order can be handed off`, ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF, { ...context, status: order.status });
    case "driver_unavailable":
      return new BusinessLogicError("The driver no longer takes orders", ERROR_CODES.DRIVER_UNAVAILABLE, { ...context, driverId });
  }
}

/** Hand each order to the driver; one result per order, in the order asked. */
export async function handOffToDriverOrders(
  db: AppDb,
  driver: DriverRow,
  requests: readonly DriverHandoffRequest[],
  actor: Actor | null,
): Promise<DriverHandoffResult[]> {
  const results: DriverHandoffResult[] = [];
  for (const request of requests) {
    const order = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, deliveryType: orders.deliveryType, stationCode: orders.stationCode })
      .from(orders)
      .where(eq(orders.id, request.orderId))
      .get();
    if (!order) {
      results.push({ orderId: request.orderId, orderNumber: null, outcome: "refused", error: new NotFoundError("Order", request.orderId) });
      continue;
    }
    const deliveryType = request.deliveryType ?? order.deliveryType;
    const handed = await handOffToDriver(db, {
      orderId: order.id,
      driverId: driver.id,
      deliveryType,
      stationCode: deliveryType === "stop_desk" ? request.stationCode?.trim() || order.stationCode || null : null,
      createdBy: actor?.id ?? null,
    });
    if (!handed.ok) {
      results.push({ orderId: order.id, orderNumber: order.orderNumber, outcome: "refused", error: refusal(handed.reason, order, driver.id) });
      continue;
    }
    if (actor) {
      await logActivity(db, actor, ACTIONS.ORDER_DRIVER_ASSIGNED, { type: "order", id: order.id, label: order.orderNumber }, {
        driverId: driver.id,
        shipmentId: handed.shipmentId,
      });
    }
    results.push({ orderId: order.id, orderNumber: order.orderNumber, outcome: "accepted", shipmentId: handed.shipmentId });
  }
  return results;
}
