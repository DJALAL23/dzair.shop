import { apiFetch } from "@/lib/api";
import type { BusinessEvent, DeliveryState, EventConsumer, EventDelivery, EventType, IssuedSecret, Redelivery, SubscriptionPattern, WebhookTest } from "./types";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

interface Page<T> extends DataEnvelope<T[]> {
  nextCursor: number | null;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** An order's Business Events, oldest first. */
export async function listOrderEvents(orderId: string) {
  return (await apiFetch<Page<BusinessEvent>>(`/api/events?orderId=${encodeURIComponent(orderId)}&after=0&limit=100`)).data;
}

export async function listEventConsumers() {
  return (await apiFetch<DataEnvelope<EventConsumer[]>>("/api/event-consumers")).data;
}

export interface WebhookFields {
  name: string;
  url: string;
  subscription: SubscriptionPattern[];
}

/** A new webhook, and its Signing Secret — the only answer that ever holds it in full. */
export async function createWebhook(fields: WebhookFields) {
  return (await apiFetch<DataEnvelope<{ consumer: EventConsumer; signingSecret: string }>>("/api/event-consumers", json("POST", { kind: "webhook", ...fields }))).data;
}

/** Start or stop any Consumer; rename, repoint or resubscribe a webhook. */
export async function updateEventConsumer(id: string, change: Partial<WebhookFields> & { enabled?: boolean }) {
  return (await apiFetch<DataEnvelope<EventConsumer>>(`/api/event-consumers/${encodeURIComponent(id)}`, json("PATCH", change))).data;
}

export async function deleteWebhook(id: string) {
  await apiFetch(`/api/event-consumers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function rotateSigningSecret(id: string) {
  return (await apiFetch<DataEnvelope<Required<IssuedSecret>>>(`/api/event-consumers/${encodeURIComponent(id)}/rotate-secret`, json("POST"))).data;
}

export async function sendTestEvent(id: string, type: EventType) {
  return (await apiFetch<DataEnvelope<WebhookTest>>(`/api/event-consumers/${encodeURIComponent(id)}/test`, json("POST", { type }))).data;
}

export async function replayToEventConsumer(id: string, range: { fromSequence: number; toSequence: number }) {
  return (await apiFetch<DataEnvelope<Redelivery>>(`/api/event-consumers/${encodeURIComponent(id)}/replay`, json("POST", range))).data;
}

/** A Consumer's Deliveries, newest event first. */
export async function listConsumerDeliveries(consumerId: string, options: { state?: DeliveryState; before?: number; limit?: number } = {}) {
  const query = new URLSearchParams({ consumerId, limit: String(options.limit ?? 20) });
  if (options.state) query.set("state", options.state);
  if (options.before !== undefined) query.set("before", String(options.before));
  const page = await apiFetch<Page<EventDelivery>>(`/api/event-deliveries?${query}`);
  return { deliveries: page.data, next: page.nextCursor };
}

/** Every Delivery of one Business Event. */
export async function listEventDeliveries(eventId: string) {
  return (await apiFetch<Page<EventDelivery>>(`/api/event-deliveries?eventId=${encodeURIComponent(eventId)}`)).data;
}

export async function retryEventDelivery(id: string) {
  return (await apiFetch<DataEnvelope<Redelivery>>(`/api/event-deliveries/${encodeURIComponent(id)}/retry`, json("POST"))).data;
}
