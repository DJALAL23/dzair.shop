/**
 * Refusing an operation the shipment does not allow now, with the reason the
 * rules give (`actions.ts`): a carrier that cannot do it at all is a 422, a
 * shipment not in a state for it is a 409. And refusing someone who may not
 * act on this kind of shipment: a carrier's is dispatch work, the store's
 * driver's is assignment work.
 */

import { BusinessLogicError, ConflictError, PermissionError, type AppError } from "@/lib/errors/classes";
import type { StaffActor } from "@/types";
import type { CarrierCapabilities } from "@/carriers/contract";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { SCOPE_FOR_KIND } from "../../../../cod-shared/shipments/actions";
import { hasPermission } from "../../../../cod-shared/rbac/utils";
import type { ShipmentKind } from "../../../../cod-shared/shipments/model";
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


export function requireKindScope(actor: StaffActor, kind: ShipmentKind, what: string): void {
  const needed = SCOPE_FOR_KIND[kind];
  if (!hasPermission(actor.scopes ?? [], needed)) throw new PermissionError(`${what} a ${kind} shipment needs ${needed}`, needed);
}
