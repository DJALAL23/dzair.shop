/**
 * Why an order write was refused, as API errors — shared by the routes and
 * the AI tools so both say the same thing.
 */

import { ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

/** The order has a shipment: its delivery is the shipment's, and its processing is finished. */
export function orderHasShipment(orderId: string, what: string): ConflictError {
  return new ConflictError(
    `This order has a shipment, so ${what}. Change the parcel through its shipment, or void the shipment first.`,
    ERROR_CODES.ORDER_HAS_SHIPMENT,
    { orderId },
  );
}

/** Someone changed the order between reading it and writing it. */
export function orderChanged(orderId: string): ConflictError {
  return new ConflictError("The order changed meanwhile; reload it and try again", ERROR_CODES.ORDER_CHANGED, { orderId });
}

/** A driver payment settled part of the order's delivery: the payment keeps the order. */
export function orderSettled(orderId: string): ConflictError {
  return new ConflictError(
    "A driver payment settled this order's delivery, so the order stays with that payment and cannot be deleted",
    ERROR_CODES.ORDER_HAS_SETTLEMENT,
    { orderId },
  );
}

export function refusalFor(
  outcome: { ok: false; reason: "not_found" | "has_shipment" | "has_open_shipment" | "settled" | "changed" },
  orderId: string,
  what: string,
) {
  switch (outcome.reason) {
    case "not_found":
      return new NotFoundError("Order", orderId);
    case "has_shipment":
    case "has_open_shipment":
      return orderHasShipment(orderId, what);
    case "settled":
      return orderSettled(orderId);
    case "changed":
      return orderChanged(orderId);
  }
}
