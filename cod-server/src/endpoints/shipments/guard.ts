/**
 * Refusing an operation the shipment does not allow now, with the reason the
 * rules give (`actions.ts`): a carrier that cannot do it at all is a 422, a
 * shipment not in a state for it is a 409.
 */

import { BusinessLogicError, ConflictError, type AppError } from "@/lib/errors/classes";
import type { CarrierCapabilities } from "@/carriers/contract";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { deliveryFactsOf, type ShipmentRow } from "../../../../cod-shared/shipments/queries";
import { checkAction, type ActionVerdict, type ShipmentAction, type ShipmentSubject } from "./actions";

export function subjectOf(row: ShipmentRow): ShipmentSubject {
  return { kind: row.kind, handoffState: row.handoffState, validatedAt: row.validatedAt, delivery: deliveryFactsOf(row) };
}

export function actionRefusal(verdict: Extract<ActionVerdict, { ok: false }>, context: Record<string, unknown>): AppError {
  return verdict.code === ERROR_CODES.OPERATION_NOT_SUPPORTED
    ? new BusinessLogicError(verdict.reason, verdict.code, context)
    : new ConflictError(verdict.reason, verdict.code, context);
}

export function requireAction(row: ShipmentRow, capabilities: CarrierCapabilities | null, action: ShipmentAction): void {
  const verdict = checkAction(subjectOf(row), capabilities, action);
  if (!verdict.ok) throw actionRefusal(verdict, { shipmentId: row.id, orderId: row.orderId, action });
}
