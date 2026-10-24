/**
 * What can be done to a shipment now — one rule set. A handler refuses an
 * operation with it, and the shipment's `actions` list (what the dashboard
 * offers) is computed from it, so the two can never disagree.
 *
 * Three things decide: the carrier's capabilities (what it can do at all),
 * where the handoff stands (an unaccepted parcel has nothing to act on), and
 * the delivery facts (a parcel out for delivery can no longer be edited).
 */

import type { CarrierCapabilities } from "@/carriers/contract";
import { ERROR_CODES, type ErrorCode } from "../../../../cod-shared/errors/codes";
import { checkVoid, isClosed, type DeliveryFacts } from "../../../../cod-shared/shipments/interpretation";
import type { HandoffState, ShipmentKind } from "../../../../cod-shared/shipments/model";
import { SHIPMENT_ACTIONS, type ShipmentAction } from "../../../../cod-shared/shipments/actions";

export type { ShipmentAction };

export interface ShipmentSubject {
  kind: ShipmentKind;
  handoffState: HandoffState;
  validatedAt: string | null;
  delivery: DeliveryFacts;
}

export type ActionVerdict = { ok: true } | { ok: false; code: ErrorCode; reason: string };

const OK: ActionVerdict = { ok: true };
const refuse = (code: ErrorCode, reason: string): ActionVerdict => ({ ok: false, code, reason });
const notSupported = (what: string) => refuse(ERROR_CODES.OPERATION_NOT_SUPPORTED, `This carrier does not support ${what}`);
const notNow = (reason: string) => refuse(ERROR_CODES.SHIPMENT_ACTION_NOT_AVAILABLE, reason);

const CARRIER_ONLY: ReadonlySet<ShipmentAction> = new Set([
  "validate",
  "update",
  "resolve",
  "lookup",
  "addRemark",
  "listRemarks",
  "askReturn",
  "requestNewAttempt",
  "confirmReturn",
  "sync",
]);

function closedVerdict(delivery: DeliveryFacts): ActionVerdict | null {
  return isClosed(delivery) ? refuse(ERROR_CODES.SHIPMENT_CLOSED, "The shipment is closed") : null;
}

export function checkAction(subject: ShipmentSubject, capabilities: CarrierCapabilities | null, action: ShipmentAction): ActionVerdict {
  const { delivery } = subject;
  if (CARRIER_ONLY.has(action) && (subject.kind !== "carrier" || !capabilities)) {
    return refuse(ERROR_CODES.OPERATION_NOT_SUPPORTED, "Only a carrier shipment supports this");
  }
  const caps = capabilities as CarrierCapabilities;

  if (action === "resolve" || action === "lookup") {
    if (subject.handoffState !== "unknown") return notNow("Only a handoff whose outcome is unknown can be resolved");
    if (action === "lookup" && !caps.findByReference) return notSupported("finding a parcel by the order number");
    return OK;
  }
  if (subject.handoffState !== "accepted") {
    return refuse(ERROR_CODES.SHIPMENT_HANDOFF_PENDING, "The carrier has not accepted this parcel yet");
  }

  switch (action) {
    case "validate":
      if (!caps.separateValidation) return notSupported("a separate validation");
      if (subject.validatedAt) return notNow("The parcel is already validated");
      return closedVerdict(delivery) ?? OK;

    case "update":
      if (!caps.update) return notSupported("editing a parcel");
      if (caps.separateValidation && subject.validatedAt) return notNow("The parcel is validated; the carrier no longer accepts changes");
      if (delivery.outForDeliveryAt || delivery.returnStartedAt) return notNow("The parcel is already on its way");
      return closedVerdict(delivery) ?? OK;

    case "void": {
      const verdict = checkVoid(delivery);
      if (!verdict.ok) return refuse(verdict.code, verdict.code === ERROR_CODES.SHIPMENT_CLOSED ? "The shipment is closed" : "The parcel already left for the customer");
      if (subject.kind === "driver" || delivery.cancelledAt) return OK;
      if (!capabilities?.cancel) return notSupported("cancelling a parcel");
      if (capabilities.separateValidation && subject.validatedAt) return notNow("The parcel is validated; cancel it at the carrier");
      return OK;
    }

    case "addRemark":
      if (!caps.remarks.add) return notSupported("remarks");
      return closedVerdict(delivery) ?? OK;

    case "listRemarks":
      return caps.remarks.list ? OK : notSupported("reading remarks");

    case "label":
      // The store's driver has no carrier to print one: CodFlow draws it (/shipping-labels) while the parcel is out.
      if (subject.kind === "driver") return closedVerdict(delivery) ?? OK;
      if (!capabilities?.label) return notSupported("labels");
      return delivery.cancelledAt ? notNow("The parcel was cancelled") : OK;

    case "askReturn":
      if (!caps.askReturn) return notSupported("return requests");
      if (!subject.validatedAt) return notNow("The parcel is not with the carrier yet");
      if (delivery.returnStartedAt) return notNow("The return has already started");
      return closedVerdict(delivery) ?? OK;

    case "requestNewAttempt":
      if (!caps.requestNewAttempt) return notSupported("asking for another delivery attempt");
      if (delivery.deliveryAttempts === 0) return notNow("No delivery attempt has failed");
      if (delivery.returnStartedAt) return notNow("The return has already started");
      return closedVerdict(delivery) ?? OK;

    case "confirmReturn":
      if (!caps.confirmReturn) return notSupported("confirming a return");
      if (!subject.validatedAt) return notNow("The parcel is not with the carrier yet");
      return closedVerdict(delivery) ?? OK;

    case "sync":
      return caps.history ? OK : notSupported("reading a parcel's history");

    case "report":
      return closedVerdict(delivery) ?? OK;
  }
}

/** Every action that `checkAction` allows now — what the dashboard offers. */
export function availableActions(subject: ShipmentSubject, capabilities: CarrierCapabilities | null): ShipmentAction[] {
  return SHIPMENT_ACTIONS.filter((action) => checkAction(subject, capabilities, action).ok);
}
