/**
 * What can be asked of a shipment after its handoff, and the permission each
 * takes — shared by the routes that enforce it and the dashboard that offers
 * only what the person may do. Whether an action is open now is the
 * server's to say (each shipment's `actions`).
 */

import { SCOPES, type Scope } from "../rbac/scopes";
import type { ShipmentKind } from "./model";

export const SHIPMENT_ACTIONS = [
  "validate",
  "update",
  "void",
  "resolve",
  "lookup",
  "addRemark",
  "listRemarks",
  "label",
  "askReturn",
  "requestNewAttempt",
  "confirmReturn",
  "sync",
  "report",
] as const;
export type ShipmentAction = (typeof SHIPMENT_ACTIONS)[number];

/** Acting on a shipment of each kind: a carrier's is dispatch work, the store's driver's is assignment work. */
export const SCOPE_FOR_KIND: Record<ShipmentKind, Scope> = {
  carrier: SCOPES.DELIVERY_DISPATCH,
  driver: SCOPES.ORDERS_ASSIGN,
};

/** The permission this action takes on a shipment of this kind. */
export function scopeForShipmentAction(action: ShipmentAction, kind: ShipmentKind): Scope {
  switch (action) {
    case "listRemarks":
    case "label":
      return SCOPES.ORDERS_READ;
    case "void":
    case "report":
      return SCOPE_FOR_KIND[kind];
    default:
      return SCOPES.DELIVERY_DISPATCH;
  }
}
