/**
 * Consumers and Deliveries as the merchant's API shows them (Events context).
 * A Signing Secret and a kind's settings are never part of either.
 */

import { z } from "@hono/zod-openapi";
import { EVENT_TYPES } from "../../../../cod-shared/events/catalogue";
import { ATTEMPT_OUTCOMES, CONSUMER_DISABLED_REASONS, DELIVERY_STATES } from "../../../../cod-shared/events/deliveries-model";

export const EventConsumerSchema = z
  .object({
    id: z.string(),
    kind: z.string().openapi({ description: "How it is reached: `meta_capi` (Meta conversions)", example: "meta_capi" }),
    name: z.string(),
    enabled: z.boolean(),
    subscription: z.array(z.string()).openapi({ description: "The Event Types it receives, each named exactly, by subject (`order.*`), or `*`", example: ["order.created", "shipment.delivered"] }),
    catalogueVersion: z.number().int().openapi({ description: "The catalogue version its Deliveries are written in" }),
    disabledReason: z.enum(CONSUMER_DISABLED_REASONS).nullable().openapi({ description: "Why it stopped receiving, while disabled: `failing` (every Attempt failed for 3 days), `merchant`, or `gone` (its endpoint answered HTTP 410 Gone)" }),
    failingSince: z.string().nullable().openapi({ description: "Since when every Attempt has failed; null once one succeeds" }),
    deliveries: z.object({
      due: z.number().int().openapi({ description: "Deliveries on their way" }),
      dead: z.number().int().openapi({ description: "Deliveries given up on, waiting for a Replay" }),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("EventConsumer");

const deliveryFields = {
  id: z.string(),
  consumerId: z.string(),
  state: z.enum(DELIVERY_STATES).openapi({ description: "`due` (on its way), `delivered`, `skipped` (declined on purpose) or `dead` (given up on)" }),
  attempts: z.number().int().openapi({ description: "Attempts since it was last made due; a retry or Replay starts them over" }),
  nextAttemptAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
  event: z.object({
    id: z.string(),
    sequence: z.number().int(),
    type: z.enum(EVENT_TYPES),
    orderId: z.string(),
    occurredAt: z.string(),
  }),
};

export const EventDeliverySchema = z.object(deliveryFields).openapi("EventDelivery");

export const EventDeliveryAttemptSchema = z
  .object({
    attempt: z.number().int(),
    attemptedAt: z.string(),
    durationMs: z.number().int(),
    outcome: z.enum(ATTEMPT_OUTCOMES),
    httpStatus: z.number().int().nullable(),
    responseExcerpt: z.string().nullable().openapi({ description: "The first kilobyte of what the Consumer answered" }),
    error: z.string().nullable(),
  })
  .openapi("EventDeliveryAttempt");

export const EventDeliveryDetailSchema = z
  .object({
    ...deliveryFields,
    attemptLog: z.array(EventDeliveryAttemptSchema).openapi({ description: "Every Attempt, oldest first — those before a retry or Replay too" }),
  })
  .openapi("EventDeliveryDetail");

export const RedeliverySchema = z
  .object({
    reopened: z.number().int().openapi({ description: "Settled Deliveries made due again" }),
    created: z.number().int().openapi({ description: "Deliveries made for events the Consumer never had one for" }),
  })
  .openapi("Redelivery");
