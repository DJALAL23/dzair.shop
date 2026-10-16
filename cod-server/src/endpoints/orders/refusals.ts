/**
 * Why an order write was refused, as API errors — shared by the routes and
 * the AI tools so both say the same thing.
 */

import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import type { LineReturn } from "../../../../cod-shared/queries/orders";
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

/** Archiving waits for the order to finish: cancelled, or its delivery ended. */
export function orderNotFinished(orderId: string): ConflictError {
  return new ConflictError(
    "Only a finished order can be archived: cancel it, or wait until its shipment is delivered, returned or cancelled",
    ERROR_CODES.ORDER_NOT_FINISHED,
    { orderId },
  );
}

export function refusalFor(
  outcome: { ok: false; reason: "not_found" | "has_shipment" | "changed" | "not_finished" },
  orderId: string,
  what: string,
) {
  switch (outcome.reason) {
    case "not_found":
      return new NotFoundError("Order", orderId);
    case "has_shipment":
      return orderHasShipment(orderId, what);
    case "changed":
      return orderChanged(orderId);
    case "not_finished":
      return orderNotFinished(orderId);
  }
}

/** Why a line return was not recorded. */
export function lineReturnRefusal(outcome: Extract<LineReturn, { ok: false }>, orderId: string, productLineId: string) {
  const context = { orderId, productLineId };
  switch (outcome.reason) {
    case "line_not_found":
      return new NotFoundError("Order line", productLineId);
    case "out_of_range":
      return new ValidationError(`returnedQuantity must be between 0 and ${outcome.quantity}`, ERROR_CODES.VALUE_OUT_OF_RANGE, context);
    case "order_closed":
      return new BusinessLogicError(
        "The order is cancelled or its parcel came back — every remaining unit is already back in stock",
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        context,
      );
    case "changed":
      return new ConflictError("The line changed meanwhile; reload the order and try again", ERROR_CODES.ORDER_CHANGED, context);
  }
}
