import { tool } from "ai";
import { z } from "zod";
import type { AppDb } from "@/db";
import { toolOutput, timestampSchema } from "@/lib/tool-output-schema";
import { isSubscriptionPattern, type SubscriptionPattern } from "../../../../cod-shared/events/subscription";
import { readEventLog } from "../../../../cod-shared/events/log";
import { DELIVERY_PAGE_MAX, listConsumers, listDeliveries } from "../../../../cod-shared/events/consumers";
import { DELIVERY_STATES } from "../../../../cod-shared/events/deliveries-model";

const patterns = z
  .string()
  .transform((value) => value.split(",").map((part) => part.trim()))
  .refine((parts) => parts.every(isSubscriptionPattern), "Each type is an Event Type (order.confirmed), a subject (order.*), or *")
  .transform((parts) => parts as SubscriptionPattern[]);

export const listBusinessEventsSchema = z.object({
  orderId: z.string().min(1).optional().describe("Only the events of this order (its UUID)"),
  type: patterns.optional().describe("Only these Event Types, comma-separated: order.confirmed, order.*, shipment.delivered…"),
  after: z.coerce.number().int().min(0).optional().describe("Read forward, oldest first, after this Sequence"),
  before: z.coerce.number().int().min(0).optional().describe("Read back, newest first, before this Sequence"),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("At most this many (1–100, default 20)"),
});

export const listEventDeliveriesSchema = z.object({
  consumerId: z.string().min(1).describe("The Consumer whose Deliveries to read (listEventConsumers gives the ids)"),
  state: z.enum(DELIVERY_STATES).optional().describe("Only Deliveries in this state — dead for those given up on"),
  before: z.coerce.number().int().min(0).optional().describe("Read on from before this event Sequence"),
  limit: z.coerce.number().int().min(1).max(DELIVERY_PAGE_MAX).default(20).describe("At most this many (default 20)"),
});

export const EVENT_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  listBusinessEvents: listBusinessEventsSchema.shape,
  listEventConsumers: {},
  listEventDeliveries: listEventDeliveriesSchema.shape,
};

const actorSchema = z.looseObject({ kind: z.string().describe("staff | agent | shopper | carrier | system"), name: z.string().nullable() });

export const EVENT_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  listBusinessEvents: toolOutput({
    count: z.number().int(),
    nextCursor: z.number().int().nullable().describe("The Sequence to pass as after (or before) for the next page; null at the end"),
    events: z.array(
      z.looseObject({
        id: z.string(),
        sequence: z.number().int().describe("Its position in the Event Log"),
        type: z.string().describe("What happened: order.confirmed, shipment.delivered…"),
        orderId: z.string(),
        occurredAt: timestampSchema,
        actor: actorSchema.describe("Who caused it"),
        origin: z.string().describe("Through what: dashboard | api | agent | storefront | carrier_webhook | carrier_sync | schedule"),
        data: z.looseObject({}).describe("The order (and shipment) as they were, and what changed"),
      }),
    ),
  }),
  listEventConsumers: toolOutput({
    consumers: z.array(
      z.looseObject({
        id: z.string(),
        kind: z.string().describe("How it is reached: meta_capi (Meta conversions)…"),
        name: z.string(),
        enabled: z.boolean(),
        disabledReason: z.string().nullable().describe("failing (every Attempt failed for 3 days) | merchant | gone (its endpoint answered HTTP 410); null while enabled"),
        deliveries: z.looseObject({ due: z.number().int(), dead: z.number().int() }).describe("On their way, and given up on"),
      }),
    ),
  }),
  listEventDeliveries: toolOutput({
    count: z.number().int(),
    nextCursor: z.number().int().nullable(),
    deliveries: z.array(
      z.looseObject({
        id: z.string(),
        state: z.enum(DELIVERY_STATES),
        attempts: z.number().int(),
        lastError: z.string().nullable(),
        event: z.looseObject({ id: z.string(), sequence: z.number().int(), type: z.string(), orderId: z.string() }),
      }),
    ),
  }),
};

const invalid = (error: z.ZodError) => ({ success: false as const, error: `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}` });

export const getEventTools = (db: AppDb) => ({
  listBusinessEvents: tool({
    description:
      "Read the store's Event Log: what happened to its orders and parcels, who did it and through what — an order created, confirmed, cancelled, a parcel handed off, delivered, returned. " +
      "Newest first by default; pass after (a Sequence, 0 for the start) to read forward. Narrow with orderId and type (order.confirmed, order.*, shipment.delivered…).",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = listBusinessEventsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      if (parsed.data.after !== undefined && parsed.data.before !== undefined) return { success: false as const, error: "Give after or before, not both" };
      const { type, ...query } = parsed.data;
      const page = await readEventLog(db, { ...query, types: type });
      return { success: true, count: page.events.length, nextCursor: page.next, events: page.events };
    },
  }),

  listEventConsumers: tool({
    description: "List who receives the store's Business Events (Meta conversions, and the integrations the merchant adds), whether each is enabled and why not, and how many Deliveries are on their way or were given up on.",
    inputSchema: z.object({}).passthrough(),
    execute: async () => ({ success: true, consumers: await listConsumers(db) }),
  }),

  listEventDeliveries: tool({
    description: "Read how a Consumer's Deliveries went, newest event first: delivered, skipped, on their way (due) or given up on (dead), with the last error. Narrow with state=dead to find what failed.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = listEventDeliveriesSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      const page = await listDeliveries(db, parsed.data);
      return { success: true, count: page.deliveries.length, nextCursor: page.next, deliveries: page.deliveries };
    },
  }),
});
