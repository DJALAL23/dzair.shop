/**
 * The OpenAPI document's `webhooks` section, generated from the Event
 * Catalogue (ADR 0018): one entry per Event Type, its body the Business Event
 * exactly as a webhook Consumer receives it, with the headers that sign it
 * and an example — so the reference cannot drift from what is sent.
 */

import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { EVENT_CATALOGUE, EVENT_TYPES, type EventType } from "../../../cod-shared/events/catalogue";
import { PUBLISHED_EVENT_SCHEMAS } from "./catalogue";
import { exampleEvent } from "./examples";
import { WEBHOOK_TIMEOUT_MS } from "./consumers/webhook";

/** `order.line_returned` → `OrderLineReturnedEvent`: the event's schema in the document's components. */
export function eventComponentName(type: EventType): string {
  return `${type
    .split(/[._]/)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("")}Event`;
}

const signedHeaders = z.object({
  "webhook-id": z.string().openapi({ description: "The event's id: the same on every Attempt and every Replay. Deduplicate by it.", example: "0f9e8d7c-6b5a-4f3e-8d2c-1b0a09080700" }),
  "webhook-timestamp": z.string().openapi({ description: "When this Attempt was sent, in Unix seconds. Refuse a request more than five minutes from your clock.", example: "1761386400" }),
  "webhook-signature": z.string().openapi({
    description:
      "Space-separated `v1,<signature>` entries: each the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed by the base64-decoded part of a Signing Secret after `whsec_`. Accept the request when one entry matches. During a rotation there is one per secret.",
    example: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  }),
});

export function registerEventWebhooks(registry: OpenAPIHono["openAPIRegistry"]): void {
  for (const type of EVENT_TYPES) {
    registry.registerWebhook({
      method: "post",
      path: type,
      tags: ["Events"],
      summary: type,
      description: `${EVENT_CATALOGUE[type].summary}\n\nPOSTed to every webhook subscribed to \`${type}\`, \`${EVENT_CATALOGUE[type].subject}.*\` or \`*\`, signed per the Standard Webhooks specification. Delivered at least once and in no promised order: recognise an event by its id, order events by their \`sequence\` or \`occurredAt\`.`,
      operationId: `webhook.${type}`,
      request: {
        headers: signedHeaders,
        body: { required: true, content: { "application/json": { schema: PUBLISHED_EVENT_SCHEMAS[type].openapi(eventComponentName(type)), example: exampleEvent(type) } } },
      },
      responses: {
        200: { description: `Any 2xx, within ${WEBHOOK_TIMEOUT_MS / 1000} s: delivered. Answer at once and do the work after.` },
        410: { description: "Gone: the store stops this webhook and sends it nothing more until the merchant starts it again." },
        default: { description: "Anything else — another status, a redirect, no answer in time: tried again on the retry schedule, no sooner than a `Retry-After` asks." },
      },
    });
  }
}
