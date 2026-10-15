import { BusinessLogicError, type AppError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import type { PaymentOutcome } from "../../../../cod-shared/queries/driver-payments";

/** Why a payment was refused, as the API reports it. */
export function paymentRefusal(outcome: Extract<PaymentOutcome, { ok: false }>, driverId: string): AppError {
  if (outcome.reason === "not_settleable") {
    return new BusinessLogicError(
      `${outcome.shipmentIds.length} shipment(s) are not this driver's delivered shipments`,
      ERROR_CODES.SHIPMENT_NOT_SETTLEABLE,
      { driverId, shipmentIds: outcome.shipmentIds },
    );
  }
  return new BusinessLogicError(
    `${outcome.shipmentIds.length} shipment(s) already have their ${outcome.component === "cod" ? "cash" : "fee"} settled`,
    ERROR_CODES.PAYMENT_ALREADY_SETTLED,
    { driverId, kind: outcome.component, shipmentIds: outcome.shipmentIds },
  );
}
