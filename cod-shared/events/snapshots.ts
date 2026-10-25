/**
 * What a Business Event says about its order and shipment: the facts as they
 * were when the event was recorded, never re-read later (Events context: "the
 * event keeps what was true").
 */

import { sql, type SQL } from "drizzle-orm";
import type { CustomFieldType } from "../checkout-form/policy";
import type { OrderStatus } from "../orders/lifecycle";
import type { ShipmentKind } from "../shipments/model";

/**
 * Money as a Business Event carries it: an exact decimal string with its
 * currency, so no consumer meets a binary float or guesses the unit (ADR 0018).
 */
export interface Money {
  amount: string;
  currency: "DZD";
}

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

/**
 * A snapshot built by D1 itself, as part of the statement that records the
 * event: it reads the order or shipment exactly as the batch has left it at
 * that point, so the event can never disagree with what was committed.
 */
export class SqlJson<T> {
  /** Never set: carries the snapshot's shape for the type checker. */
  declare readonly shape?: T;
  constructor(readonly sql: SQL) {}
}

const moneySql = (column: SQL) => sql`json_object('amount', printf('%.2f', ${column}), 'currency', 'DZD')`;
const instantSql = (column: SQL) => sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;
const namedSql = (id: SQL, name: SQL) => sql`case when ${id} is null and ${name} is null then null else json_object('id', ${id}, 'name', ${name}) end`;

const orderJson = (orderId: SQL) => sql`(select json_object(
  'id', o.id,
  'number', o.order_number,
  'status', o.status,
  'type', o.order_type,
  'placedAt', ${instantSql(sql`o.created_at`)},
  'customer', json_object('id', o.customer_id, 'name', o.customer_name, 'phone', o.phone, 'email', o.customer_email),
  'destination', json_object(
    'wilaya', json((select json_object('id', w.id, 'name', w.name, 'nameAr', w.name_ar) from wilayas w where w.id = o.wilaya_id)),
    'commune', json((select json_object('id', c.id, 'name', c.name, 'nameAr', c.name_ar) from communes c where c.id = o.commune_id)),
    'city', o.city,
    'address', o.address,
    'deliveryType', o.delivery_type,
    'stationCode', o.station_code
  ),
  'lines', json((select json_group_array(json(line)) from (
    select json_object(
      'id', op.id,
      'productId', op.product_id,
      'variantId', op.variant_id,
      'name', op.product_name,
      'variantLabel', op.variant_label,
      'sku', op.sku,
      'quantity', op.quantity,
      'unitPrice', ${moneySql(sql`op.price_per_unit`)},
      'discount', ${moneySql(sql`op.discount`)},
      'total', ${moneySql(sql`op.line_total`)},
      'gift', json(case when op.reward then 'true' else 'false' end),
      'offer', ${namedSql(sql`op.offer_id`, sql`op.offer_name`)},
      'returnedQuantity', op.returned_quantity
    ) as line
    from order_products op where op.order_id = o.id order by op.created_at, op.id
  ))),
  'subtotal', ${moneySql(sql`o.price`)},
  'deliveryFee', ${moneySql(sql`o.delivery_fee`)},
  'total', ${moneySql(sql`o.cod_amount`)},
  'coupon', case when o.coupon_code is null then null else json_object('code', o.coupon_code, 'discount', ${moneySql(sql`o.coupon_discount`)}) end,
  'freeDeliveryOffer', ${namedSql(sql`o.delivery_offer_id`, sql`o.delivery_offer_name`)},
  'notes', o.notes,
  'customFields', case when json_valid(o.custom_fields_json) then json(o.custom_fields_json) else json('[]') end
) from orders o where o.id = ${orderId})`;

/** The order as it stands where this statement runs in the batch. */
export function orderSnapshot(orderId: string): SqlJson<OrderSnapshot> {
  return new SqlJson(orderJson(sql`${orderId}`));
}
