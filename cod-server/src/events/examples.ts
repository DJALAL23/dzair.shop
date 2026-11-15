/**
 * One example of every Event Type, as a Consumer receives it: one order and
 * its parcel through a plausible day in Algiers. They are the test event a
 * merchant sends to an endpoint, the OpenAPI document's webhook examples and
 * the developer docs' — held to the published schema by `examples.test.ts`.
 */

import { EVENT_CATALOGUE, EVENT_TYPES, type EventData, type EventType } from "../../../cod-shared/events/catalogue";
import type { Actor, Origin } from "../../../cod-shared/events/actor";
import type { BusinessEvent } from "../../../cod-shared/events/log";
import type { Money, OrderSnapshot, ReviewSnapshot, ShipmentSnapshot } from "../../../cod-shared/events/snapshots";
import type { OrderStatus } from "../../../cod-shared/orders/lifecycle";

const dzd = (dinars: number): Money => ({ amount: dinars.toFixed(2), currency: "DZD" });

const ORDER_ID = "7f3c2a9e-4b1d-4e8a-9c55-2d6f0b8e1a47";
const SHIPMENT_ID = "c41e8d2b-90f3-4a6c-b7d1-5e2a9f0c3b68";
const REVIEW_ID = "3e5a7c9e-1b3d-4f5a-8c7e-9b1d3f5a7c9e";
const KARIM = { id: "7b9d1f3a-5c7e-4a9b-8d1f-3a5c7e9b1d3f", name: "Karim" };

const order = (status: OrderStatus, team: Partial<Pick<OrderSnapshot, "unansweredCalls" | "callbackAt" | "assignee">> = {}): OrderSnapshot => ({
  id: ORDER_ID,
  number: "ORD-20261025-0042",
  status,
  type: "online",
  placedAt: "2026-10-25T09:14:03.120Z",
  locale: "ar",
  customer: { id: "5a0e7c13-8f2b-4d9e-a6c4-1b3d5f7e9a20", name: "Amina Benali", phone: "0551234567", email: null },
  destination: {
    wilaya: { id: 16, name: "Alger", nameAr: "الجزائر" },
    commune: { id: "16001", name: "Alger Centre", nameAr: "الجزائر الوسطى" },
    city: null,
    address: "12 rue Didouche Mourad",
    deliveryType: "home",
    stationCode: null,
  },
  lines: [
    {
      id: "b2d4f6a8-1c3e-4a5b-8d7f-9e0a1b2c3d4e",
      productId: "e8a1c3b5-7d9f-4b2a-a4c6-8e0f2a4c6e8a",
      variantId: "f1b3d5c7-9e1a-4c3b-b5d7-9f1b3d5f7a9c",
      name: "Robe kabyle",
      variantLabel: "Rouge / M",
      sku: "RK-R-M",
      quantity: 2,
      unitPrice: dzd(4500),
      discount: dzd(500),
      total: dzd(8500),
      gift: false,
      offer: { id: "a7c9e1b3-5d7f-4a9c-8e1b-3d5f7a9c1e3b", name: "La deuxième à -500 DA" },
      returnedQuantity: 0,
    },
  ],
  subtotal: dzd(8500),
  deliveryFee: dzd(500),
  total: dzd(9000),
  coupon: null,
  freeDeliveryOffer: null,
  notes: "Appeler avant de passer",
  customFields: [{ id: "c3e5a7b9-1d3f-4b5a-9c7e-1f3a5b7d9e1f", label: "Taille habituelle", type: "select", value: "M" }],
  unansweredCalls: 0,
  callbackAt: null,
  assignee: KARIM,
  ...team,
});

const CALLBACK_AT = "2026-10-25T13:30:00.000Z";

const review: ReviewSnapshot = {
  id: REVIEW_ID,
  product: { id: "e8a1c3b5-7d9f-4b2a-a4c6-8e0f2a4c6e8a", name: "Robe kabyle" },
  rating: 4,
  title: "Très belle robe",
  body: "Le tissu est beau et la taille correspond. La livraison a pris trois jours.",
  status: "pending",
  verified: true,
  customerName: "Amina Benali",
  photos: 2,
  voiceNote: false,
  submittedAt: "2026-10-27T18:42:10.000Z",
};

const shipment = (milestones: Partial<ShipmentSnapshot> = {}): ShipmentSnapshot => ({
  id: SHIPMENT_ID,
  kind: "carrier",
  carrier: { companyId: "9b1d3f5a-7c9e-4b1d-a3f5-7c9e1b3d5f7a", name: "Yalidine", provider: "yalidine" },
  driver: null,
  trackingNumber: "yal-8KQ2M7",
  deliveryType: "home",
  stationCode: null,
  codAmount: dzd(9000),
  providerStatus: { value: "Expédié", label: null },
  handedOffAt: "2026-10-25T11:02:40.000Z",
  outForDeliveryAt: null,
  deliveredAt: null,
  returnStartedAt: null,
  returnedAt: null,
  cancelledAt: null,
  deliveryAttempts: 0,
  ...milestones,
});

const outForDelivery = { outForDeliveryAt: "2026-10-26T08:31:00.000Z", providerStatus: { value: "Sorti en livraison", label: null } };
const failedOnce = { ...outForDelivery, deliveryAttempts: 1, providerStatus: { value: "Tentative échouée", label: "Client injoignable" } };
const returning = { ...failedOnce, returnStartedAt: "2026-10-28T09:10:00.000Z", providerStatus: { value: "Retour vers vendeur", label: null } };

const STAFF: Actor = { kind: "staff", id: "1d3f5a7c-9e1b-4d3f-a5c7-9e1b3d5f7a9c", name: "Samira" };
const CARRIER: Actor = { kind: "carrier", id: "9b1d3f5a-7c9e-4b1d-a3f5-7c9e1b3d5f7a", name: "Yalidine" };
const SHOPPER: Actor = { kind: "shopper", id: null, name: null };

interface Example<T extends EventType> {
  occurredAt: string;
  actor: Actor;
  origin: Origin;
  data: EventData<T>;
}

const EXAMPLES: { [T in EventType]: Example<T> } = {
  "order.created": { occurredAt: "2026-10-25T09:14:03.120Z", actor: SHOPPER, origin: "storefront", data: { order: order("new") } },
  "order.updated": { occurredAt: "2026-10-25T09:38:12.000Z", actor: STAFF, origin: "dashboard", data: { order: order("new"), changedFields: ["customerPhone", "notes"] } },
  "order.confirmed": { occurredAt: "2026-10-25T09:40:55.000Z", actor: STAFF, origin: "dashboard", data: { order: order("confirmed"), previousStatus: "new" } },
  "order.unreachable": { occurredAt: "2026-10-25T09:40:55.000Z", actor: STAFF, origin: "dashboard", data: { order: order("unreachable", { unansweredCalls: 1 }), previousStatus: "new" } },
  "order.preparing": { occurredAt: "2026-10-25T10:05:00.000Z", actor: STAFF, origin: "dashboard", data: { order: order("preparing"), previousStatus: "confirmed" } },
  "order.ready": { occurredAt: "2026-10-25T10:48:30.000Z", actor: STAFF, origin: "dashboard", data: { order: order("ready"), previousStatus: "preparing" } },
  "order.cancelled": { occurredAt: "2026-10-25T12:20:00.000Z", actor: STAFF, origin: "dashboard", data: { order: order("cancelled", { unansweredCalls: 3, assignee: KARIM }), previousStatus: "unreachable" } },
  "order.line_returned": {
    occurredAt: "2026-10-26T13:05:00.000Z",
    actor: STAFF,
    origin: "dashboard",
    data: { order: { ...order("ready"), lines: order("ready").lines.map((line) => ({ ...line, returnedQuantity: 1 })) }, lineId: "b2d4f6a8-1c3e-4a5b-8d7f-9e0a1b2c3d4e", previousReturnedQuantity: 0 },
  },
  "order.deleted": { occurredAt: "2026-10-25T12:30:00.000Z", actor: STAFF, origin: "dashboard", data: { order: order("cancelled") } },
  "order.assigned": {
    occurredAt: "2026-10-25T09:14:03.120Z",
    actor: { kind: "system", id: null, name: null },
    origin: "storefront",
    data: { order: order("new"), assignee: KARIM, previousAssignee: null, way: "automatic" },
  },
  "order.unassigned": { occurredAt: "2026-10-25T09:30:00.000Z", actor: STAFF, origin: "dashboard", data: { order: order("new", { assignee: null }), previousAssignee: KARIM } },
  "order.callback_scheduled": {
    occurredAt: "2026-10-25T09:41:20.000Z",
    actor: STAFF,
    origin: "dashboard",
    data: { order: order("unreachable", { unansweredCalls: 1, callbackAt: CALLBACK_AT }), at: CALLBACK_AT, previousAt: null },
  },
  "order.callback_cleared": { occurredAt: "2026-10-25T11:05:00.000Z", actor: STAFF, origin: "dashboard", data: { order: order("unreachable", { unansweredCalls: 1 }), previousAt: CALLBACK_AT } },
  "order.callback_due": {
    occurredAt: CALLBACK_AT,
    actor: { kind: "system", id: null, name: null },
    origin: "schedule",
    data: { order: order("unreachable", { unansweredCalls: 1, callbackAt: CALLBACK_AT }), at: CALLBACK_AT },
  },
  "shipment.handed_off": { occurredAt: "2026-10-25T11:02:40.000Z", actor: STAFF, origin: "dashboard", data: { shipment: shipment(), order: order("ready") } },
  "shipment.out_for_delivery": { occurredAt: "2026-10-26T08:31:00.000Z", actor: CARRIER, origin: "carrier_webhook", data: { shipment: shipment(outForDelivery), order: order("ready"), reason: null } },
  "shipment.delivery_failed": {
    occurredAt: "2026-10-26T15:47:00.000Z",
    actor: CARRIER,
    origin: "carrier_webhook",
    data: { shipment: shipment(failedOnce), order: order("ready"), reason: "Client injoignable", attempt: 1 },
  },
  "shipment.delivered": {
    occurredAt: "2026-10-26T13:05:00.000Z",
    actor: CARRIER,
    origin: "carrier_webhook",
    data: { shipment: shipment({ ...outForDelivery, deliveredAt: "2026-10-26T13:05:00.000Z", providerStatus: { value: "Livré", label: null } }), order: order("ready"), reason: null },
  },
  "shipment.return_started": { occurredAt: "2026-10-28T09:10:00.000Z", actor: CARRIER, origin: "carrier_sync", data: { shipment: shipment(returning), order: order("ready"), reason: "Refusé par le client" } },
  "shipment.returned": {
    occurredAt: "2026-10-30T10:00:00.000Z",
    actor: CARRIER,
    origin: "carrier_sync",
    data: { shipment: shipment({ ...returning, returnedAt: "2026-10-30T10:00:00.000Z", providerStatus: { value: "Retourné au vendeur", label: null } }), order: order("ready"), reason: "Refusé par le client" },
  },
  "shipment.cancelled": {
    occurredAt: "2026-10-25T14:00:00.000Z",
    actor: STAFF,
    origin: "dashboard",
    data: { shipment: shipment({ cancelledAt: "2026-10-25T14:00:00.000Z", providerStatus: { value: "Annulé", label: null } }), order: order("ready"), reason: "Le client a changé d'adresse" },
  },
  "shipment.voided": { occurredAt: "2026-10-25T11:20:00.000Z", actor: STAFF, origin: "dashboard", data: { shipment: shipment(), order: order("ready") } },
  "review.submitted": { occurredAt: review.submittedAt, actor: SHOPPER, origin: "storefront", data: { review, order: order("ready") } },
};

const SUBJECT_IDS = { order: ORDER_ID, shipment: SHIPMENT_ID, review: REVIEW_ID } as const;

const EVENT_IDS: Record<EventType, string> = Object.fromEntries(
  EVENT_TYPES.map((type, i) => [type, `0f9e8d7c-6b5a-4f3e-8d2c-${(0x1b0a09080700 + i).toString(16).padStart(12, "0")}`]),
) as Record<EventType, string>;

/** An example Business Event of this type, exactly as a Consumer receives it. */
export function exampleEvent<T extends EventType>(type: T): Extract<BusinessEvent, { type: T }> {
  const { occurredAt, actor, origin, data } = EXAMPLES[type];
  const subject = EVENT_CATALOGUE[type].subject;
  return {
    id: EVENT_IDS[type],
    sequence: 1040 + EVENT_TYPES.indexOf(type),
    type,
    version: EVENT_CATALOGUE[type].version,
    subject: { type: subject, id: SUBJECT_IDS[subject] },
    orderId: ORDER_ID,
    occurredAt,
    recordedAt: occurredAt.replace(/\.\d{3}Z$/, ".480Z"),
    actor,
    origin,
    data,
  } as Extract<BusinessEvent, { type: T }>;
}
