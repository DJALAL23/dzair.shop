/**
 * Consumers and Deliveries as the merchant's API shows them (Events context).
 * A Signing Secret is shown in full only in the answer that makes it; a
 * kind's settings, only as far as the merchant typed them in.
 */

import { z } from "@hono/zod-openapi";
import { EVENT_TYPES } from "../../../../cod-shared/events/catalogue";
import { ATTEMPT_OUTCOMES, CONSUMER_DISABLED_REASONS, DELIVERY_STATES } from "../../../../cod-shared/events/deliveries-model";
import { WEBHOOK_TEST_OUTCOMES } from "../../../../cod-shared/events/webhooks";

export const EventConsumerSchema = z
  .object({
    id: z.string(),
    kind: z.string().openapi({ description: "How it is reached: `webhook` (an endpoint of the merchant's own) or `meta_capi` (Meta conversions)", example: "webhook" }),
    name: z.string(),
    enabled: z.boolean(),
    builtIn: z.boolean().openapi({ description: "Kept by its App (Meta conversions, by the Meta App): it can be started and stopped, not edited or deleted" }),
    subscription: z.array(z.string()).openapi({ description: "The Event Types it receives, each named exactly, by subject (`order.*`), or `*`", example: ["order.created", "shipment.delivered"] }),
    catalogueVersion: z.number().int().openapi({ description: "The catalogue version its Deliveries are written in" }),
    disabledReason: z.enum(CONSUMER_DISABLED_REASONS).nullable().openapi({ description: "Why it stopped receiving, while disabled: `failing` (every Attempt failed for 3 days), `merchant`, `gone` (its endpoint answered HTTP 410 Gone), `bot_blocked` (its Telegram chat blocked the bot), or `not_connected` (no Telegram chat connected yet)" }),
    failingSince: z.string().nullable().openapi({ description: "Since when every Attempt has failed; null once one succeeds" }),
    deliveries: z.object({
      due: z.number().int().openapi({ description: "Deliveries on their way" }),
      dead: z.number().int().openapi({ description: "Deliveries given up on, waiting for a Replay" }),
    }),
    webhook: z
      .object({
        url: z.string(),
        signingSecret: z.string().openapi({ description: "The Signing Secret, masked: shown in full only when it is made", example: "••••Xw4=", "x-credential": "masked" }),
        secretRotatedAt: z.iso.datetime({ offset: true }).nullable(),
        previousSecretSignsUntil: z.iso.datetime({ offset: true }).nullable().openapi({ description: "After a rotation, until when Deliveries are also signed with the previous secret" }),
      })
      .nullable()
      .openapi({ description: "A webhook Consumer's endpoint; null for any other kind" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("EventConsumer");

const signingSecret = z.string().openapi({
  description: "The Signing Secret, in full: shown this once. Verify Deliveries with it (Standard Webhooks)",
  example: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  "x-credential": "issued",
});

export const WebhookCreatedSchema = z.object({ consumer: EventConsumerSchema, signingSecret }).openapi("WebhookCreated");

export const SigningSecretSchema = z
  .object({
    signingSecret,
    previousSecretSignsUntil: z.iso.datetime({ offset: true }).openapi({ description: "Until when Deliveries are also signed with the secret this one replaces" }),
  })
  .openapi("SigningSecret");

export const WebhookTestSchema = z
  .object({
    event: z.object({ id: z.string().openapi({ example: "test_0b7e4c1a-2f7d-4a52-9d1e-1f3c5a9b7e21" }), type: z.enum(EVENT_TYPES) }),
    outcome: z.enum(WEBHOOK_TEST_OUTCOMES).openapi({ description: "What a Delivery's Attempt would have come to" }),
    httpStatus: z.number().int().nullable(),
    durationMs: z.number().int(),
    response: z.string().nullable().openapi({ description: "The start of what the endpoint answered" }),
    error: z.string().nullable(),
  })
  .openapi("WebhookTest");

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
