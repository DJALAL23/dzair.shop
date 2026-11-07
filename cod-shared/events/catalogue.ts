/**
 * The Event Catalogue — every Event Type the store publishes and the shape of
 * its current version's data (ADR 0018). A published version is a promise to
 * every consumer: it is only ever added to. The schemas that hold the promise
 * live server-side (`cod-server/src/events/catalogue.ts`); this module is the
 * types writers build events from.
 */

import type { SQL } from "drizzle-orm";
import type { OrderStatus } from "../orders/lifecycle";
import type { Milestone } from "../shipments/interpretation";
import type { Actor, Origin } from "./actor";
import type { OrderSnapshot, ShipmentSnapshot, SqlJson } from "./snapshots";

export type EventSubject = "order" | "shipment";

/** Each Event Type: its subject, its current version, and what it means, as the published reference says it. */
export const EVENT_CATALOGUE = {
  "order.created": { subject: "order", version: 1, summary: "An order was placed: on the store, in the dashboard, through the API or by an AI agent." },
  "order.updated": { subject: "order", version: 1, summary: "An order's customer, destination or notes were edited." },
  "order.confirmed": { subject: "order", version: 1, summary: "The customer confirmed the order, usually on the phone." },
  "order.unreachable": { subject: "order", version: 1, summary: "The customer could not be reached to confirm the order." },
  "order.preparing": { subject: "order", version: 1, summary: "The order is being prepared." },
  "order.ready": { subject: "order", version: 1, summary: "The order is packed and ready to hand to delivery." },
  "order.cancelled": { subject: "order", version: 1, summary: "The order was cancelled." },
  "order.line_returned": { subject: "order", version: 1, summary: "Units of an order line were refused at the door and came back." },
  "order.deleted": { subject: "order", version: 1, summary: "The order was deleted; the event carries it as it was." },
  "shipment.handed_off": { subject: "shipment", version: 1, summary: "The order was handed to a carrier or to one of the store's drivers." },
  "shipment.out_for_delivery": { subject: "shipment", version: 1, summary: "The parcel left for the customer." },
  "shipment.delivery_failed": { subject: "shipment", version: 1, summary: "An attempt to deliver the parcel failed." },
  "shipment.delivered": { subject: "shipment", version: 1, summary: "The parcel was delivered and paid for on delivery." },
  "shipment.return_started": { subject: "shipment", version: 1, summary: "The parcel is on its way back to the store." },
  "shipment.returned": { subject: "shipment", version: 1, summary: "The parcel is back with the store." },
  "shipment.cancelled": { subject: "shipment", version: 1, summary: "The shipment was cancelled before it was delivered." },
  "shipment.voided": { subject: "shipment", version: 1, summary: "The handoff was undone: the order is no longer with delivery." },
} as const satisfies Record<string, { subject: EventSubject; version: number; summary: string }>;

export type EventType = keyof typeof EVENT_CATALOGUE;
export const EVENT_TYPES = Object.keys(EVENT_CATALOGUE) as EventType[];

/** The Event Type an order's move to each status records; `new` is `order.created`. */
export const ORDER_STATUS_EVENT = {
  confirmed: "order.confirmed",
  unreachable: "order.unreachable",
  preparing: "order.preparing",
  ready: "order.ready",
  cancelled: "order.cancelled",
} as const satisfies Record<Exclude<OrderStatus, "new">, EventType>;

/** The status each processing event leaves its order in: an order's timeline, read from the Event Log. */
export const ORDER_STATUS_OF_EVENT = {
  "order.created": "new",
  "order.confirmed": "confirmed",
  "order.unreachable": "unreachable",
  "order.preparing": "preparing",
  "order.ready": "ready",
  "order.cancelled": "cancelled",
} as const satisfies Record<string, OrderStatus>;

export type OrderProcessingEvent = keyof typeof ORDER_STATUS_OF_EVENT;

/** The Event Type each shipment Milestone records when it is first reached. */
export const MILESTONE_EVENT = {
  out_for_delivery: "shipment.out_for_delivery",
  delivered: "shipment.delivered",
  return_started: "shipment.return_started",
  returned: "shipment.returned",
  cancelled: "shipment.cancelled",
} as const satisfies Record<Milestone, EventType>;

/** The parts of an order an edit can change, as `order.updated` names them. */
export const ORDER_FIELDS = ["customerName", "customerPhone", "customerEmail", "destination", "notes"] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

interface OrderStatusChange {
  order: OrderSnapshot;
  previousStatus: OrderStatus;
}

interface ShipmentChange {
  shipment: ShipmentSnapshot;
  order: OrderSnapshot;
}

interface ShipmentReport extends ShipmentChange {
  /** Why, as the carrier or the merchant reported it. */
  reason: string | null;
}

interface FailedAttempt extends ShipmentReport {
  /** Which delivery attempt failed, counting from 1. */
  attempt: number;
}

export interface EventDataMap {
  "order.created": { order: OrderSnapshot };
  "order.updated": { order: OrderSnapshot; changedFields: OrderField[] };
  "order.confirmed": OrderStatusChange;
  "order.unreachable": OrderStatusChange;
  "order.preparing": OrderStatusChange;
  "order.ready": OrderStatusChange;
  "order.cancelled": OrderStatusChange;
  "order.line_returned": { order: OrderSnapshot; lineId: string; previousReturnedQuantity: number };
  "order.deleted": { order: OrderSnapshot };
  "shipment.handed_off": ShipmentChange;
  "shipment.out_for_delivery": ShipmentReport;
  "shipment.delivery_failed": FailedAttempt;
  "shipment.delivered": ShipmentReport;
  "shipment.return_started": ShipmentReport;
  "shipment.returned": ShipmentReport;
  "shipment.cancelled": ShipmentReport;
  "shipment.voided": ShipmentChange;
}

export type EventData<T extends EventType> = EventDataMap[T];

/** An event's data as a writer gives it: each part a value, or a snapshot D1 builds as the event is written. */
export type DraftData<T extends EventType> = { [K in keyof EventData<T>]: EventData<T>[K] | SqlJson<EventData<T>[K]> };

/** A Business Event as a writer hands it over, before the Event Log numbers it. */
export type BusinessEventDraft = {
  [T in EventType]: {
    type: T;
    /** The order's or the shipment's id, as the type's subject says. */
    subjectId: string;
    /** The order it concerns, for the order's timeline — or the statement that finds it, for a writer that knows only the shipment. */
    orderId: string | SQL;
    occurredAt: string;
    actor: Actor;
    origin: Origin;
    data: DraftData<T>;
  };
}[EventType];
