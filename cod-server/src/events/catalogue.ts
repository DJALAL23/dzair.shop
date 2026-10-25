/**
 * The Event Catalogue's schemas — the shape of every Event Type's current
 * version, as consumers receive it (ADR 0018). Each is held to the type
 * writers build from (`cod-shared/events/catalogue.ts`) at compile time, and
 * to its released snapshot by `catalogue.contract.test.ts`, which refuses any
 * change a consumer could trip on.
 */

import { z } from "@hono/zod-openapi";
import { ORDER_STATUSES } from "../../../cod-shared/orders/lifecycle";
import { SHIPMENT_KINDS } from "../../../cod-shared/shipments/model";
import { STORE_LOCALES } from "../../../cod-shared/i18n/locales";
import { ORDER_FIELDS, EVENT_CATALOGUE, EVENT_TYPES, type EventData, type EventType } from "../../../cod-shared/events/catalogue";
import { ORIGINS } from "../../../cod-shared/events/actor";

const money = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.literal("DZD"),
});

const instant = z.iso.datetime({ offset: true });

const place = <Id extends z.ZodNumber | z.ZodString>(id: Id) => z.object({ id, name: z.string(), nameAr: z.string() });

const named = z.object({ id: z.string().nullable(), name: z.string().nullable() });

const orderLine = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  variantId: z.string().nullable(),
  name: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int(),
  unitPrice: money,
  discount: money,
  total: money,
  gift: z.boolean(),
  offer: named.nullable(),
  returnedQuantity: z.number().int(),
});

const deliveryType = z.enum(["home", "stop_desk"]);

const order = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(ORDER_STATUSES),
  type: z.enum(["online", "offline"]),
  placedAt: instant,
  locale: z.enum(STORE_LOCALES).nullable(),
  customer: z.object({ id: z.string(), name: z.string(), phone: z.string(), email: z.string().nullable() }),
  destination: z.object({
    wilaya: place(z.number().int()).nullable(),
    commune: place(z.string()).nullable(),
    city: z.string().nullable(),
    address: z.string().nullable(),
    deliveryType,
    stationCode: z.string().nullable(),
  }),
  lines: z.array(orderLine),
  subtotal: money,
  deliveryFee: money,
  total: money,
  coupon: z.object({ code: z.string(), discount: money }).nullable(),
  freeDeliveryOffer: named.nullable(),
  notes: z.string().nullable(),
  customFields: z.array(
    z.object({ id: z.string(), label: z.string(), type: z.enum(["text", "textarea", "number", "select"]), value: z.string() }),
  ),
});

const shipment = z.object({
  id: z.string(),
  kind: z.enum(SHIPMENT_KINDS),
  carrier: z.object({ companyId: z.string(), name: z.string(), provider: z.string().nullable() }).nullable(),
  driver: z.object({ id: z.string(), name: z.string(), phone: z.string() }).nullable(),
  trackingNumber: z.string().nullable(),
  deliveryType,
  stationCode: z.string().nullable(),
  codAmount: money,
  providerStatus: z.object({ value: z.string(), label: z.string().nullable() }).nullable(),
  handedOffAt: instant,
  outForDeliveryAt: instant.nullable(),
  deliveredAt: instant.nullable(),
  returnStartedAt: instant.nullable(),
  returnedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  deliveryAttempts: z.number().int(),
});

const statusChange = z.object({ order, previousStatus: z.enum(ORDER_STATUSES) });
const shipmentChange = z.object({ shipment, order });
const shipmentReport = shipmentChange.extend({ reason: z.string().nullable() });

export const EVENT_DATA_SCHEMAS = {
  "order.created": z.object({ order }),
  "order.updated": z.object({ order, changedFields: z.array(z.enum(ORDER_FIELDS)) }),
  "order.confirmed": statusChange,
  "order.unreachable": statusChange,
  "order.preparing": statusChange,
  "order.ready": statusChange,
  "order.cancelled": statusChange,
  "order.line_returned": z.object({ order, lineId: z.string(), previousReturnedQuantity: z.number().int() }),
  "order.deleted": z.object({ order }),
  "shipment.handed_off": shipmentChange,
  "shipment.out_for_delivery": shipmentReport,
  "shipment.delivery_failed": shipmentReport.extend({ attempt: z.number().int() }),
  "shipment.delivered": shipmentReport,
  "shipment.return_started": shipmentReport,
  "shipment.returned": shipmentReport,
  "shipment.cancelled": shipmentReport,
  "shipment.voided": shipmentChange,
} satisfies { [T in EventType]: z.ZodType<EventData<T>> };

const actor = z.union([
  z.object({ kind: z.enum(["staff", "agent", "carrier"]), id: z.string(), name: z.string() }),
  z.object({ kind: z.enum(["shopper", "system"]), id: z.null(), name: z.null() }),
]);

const publishedAs = <T extends EventType>(type: T) =>
  z.object({
    id: z.string(),
    sequence: z.number().int(),
    type: z.literal(type),
    version: z.number().int(),
    subject: z.object({ type: z.literal(EVENT_CATALOGUE[type].subject), id: z.string() }),
    orderId: z.string(),
    occurredAt: instant,
    recordedAt: instant,
    actor,
    origin: z.enum(ORIGINS),
    data: EVENT_DATA_SCHEMAS[type] as (typeof EVENT_DATA_SCHEMAS)[T],
  });

type Published = { [T in EventType]: ReturnType<typeof publishedAs<T>> };

/** Each Event Type's Business Event as it is published, envelope and data. */
export const PUBLISHED_EVENT_SCHEMAS = Object.fromEntries(EVENT_TYPES.map((type) => [type, publishedAs(type)])) as unknown as Published;

/** Every Business Event as it is published — the API's Event Log and every Consumer receive this shape. */
export const BUSINESS_EVENT_SCHEMA = z.discriminatedUnion(
  "type",
  EVENT_TYPES.map((type) => PUBLISHED_EVENT_SCHEMAS[type]) as unknown as [Published[EventType], ...Published[EventType][]],
);

/** The JSON Schema consumers are promised for a type's current version. */
export function eventDataJsonSchema(type: EventType): Record<string, unknown> {
  return z.toJSONSchema(EVENT_DATA_SCHEMAS[type], { io: "output" }) as Record<string, unknown>;
}

/** A released version's schema is kept at `src/events/released/<type>.v<version>.json`. */
export function releasedSnapshotName(type: string, version: number): string {
  return `${type}.v${version}.json`;
}

export function parseReleasedSnapshotName(name: string): { type: string; version: number } | null {
  const match = /^(?<type>[a-z_]+\.[a-z_]+)\.v(?<version>[1-9]\d*)\.json$/.exec(name);
  return match?.groups ? { type: match.groups.type, version: Number(match.groups.version) } : null;
}
