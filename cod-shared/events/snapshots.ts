/**
 * What a Business Event says about its order and shipment: the facts as they
 * were when the event was recorded, never re-read later (Events context: "the
 * event keeps what was true").
 */

import type { CustomFieldType } from "../checkout-form/policy";
import type { OrderStatus } from "../orders/lifecycle";
import type { ShipmentKind } from "../shipments/model";
import type { Money } from "./money";

export interface Place<Id extends string | number> {
  id: Id;
  name: string;
  nameAr: string;
}

export interface OrderLineSnapshot {
  id: string;
  /** Null once the product was removed; the line keeps what was sold. */
  productId: string | null;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: Money;
  /** The line's share of the coupon's discount. */
  discount: Money;
  /** Net of the discount. */
  total: Money;
  /** Given by an offer, at no charge. */
  gift: boolean;
  offer: { id: string | null; name: string | null } | null;
  /** Units the customer refused at the door (Line Return). */
  returnedQuantity: number;
}

export interface OrderSnapshot {
  id: string;
  number: string;
  status: OrderStatus;
  type: "online" | "offline";
  placedAt: string;
  customer: { id: string; name: string; phone: string; email: string | null };
  destination: {
    wilaya: Place<number> | null;
    commune: Place<string> | null;
    city: string | null;
    address: string | null;
    deliveryType: "home" | "stop_desk";
    stationCode: string | null;
  };
  lines: OrderLineSnapshot[];
  /** The goods, net of the coupon. */
  subtotal: Money;
  deliveryFee: Money;
  /** What the customer pays on delivery. */
  total: Money;
  coupon: { code: string; discount: Money } | null;
  /** The offer that made delivery free. */
  freeDeliveryOffer: { id: string | null; name: string | null } | null;
  notes: string | null;
  customFields: { id: string; label: string; type: CustomFieldType; value: string }[];
}

export interface ShipmentSnapshot {
  id: string;
  kind: ShipmentKind;
  carrier: { companyId: string; name: string; provider: string } | null;
  driver: { id: string; name: string; phone: string } | null;
  trackingNumber: string | null;
  deliveryType: "home" | "stop_desk";
  stationCode: string | null;
  /** The cash the courier or driver collects. */
  codAmount: Money;
  /** The carrier's own words for where the parcel is, as last reported. */
  providerStatus: { value: string; label: string | null } | null;
  handedOffAt: string;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  returnStartedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  deliveryAttempts: number;
}
