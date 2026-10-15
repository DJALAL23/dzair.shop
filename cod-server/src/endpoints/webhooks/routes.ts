/**
 * Webhook Routes
 *
 * Public router — NO auth middleware anywhere in this file. A delivery is
 * authenticated by its signature, which also tells which company it is for
 * (Svix HMAC-SHA256 for ZR Express, HMAC-SHA256 for Yalidine).
 *
 * Mount order in index.ts:
 *   app.route("/webhooks", webhooksRouter)  ← BEFORE app.use("/api/*", authMiddleware)
 *
 * Built with defineRoute() — the standard route-builder pattern.
 *
 * Deliberately NO request-body validation on the event-delivery routes:
 * handlers must read the RAW body (c.req.text()) before any JSON parsing
 * because Svix signatures verify raw bytes — framework parsing here would
 * break that contract. Payload shapes are documented in the route
 * descriptions and the handlers enforce their own specific error codes.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import {
  handleYalidineChallenge,
  handleYalidineWebhook,
  handleZrWebhook,
} from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── Response schemas ─────────────────────────────────────────────────────────

const receivedResponse = {
  description: "Stored in the inbox; processed after this answer (a duplicate delivery is stored once)",
  content: jsonContent(
    z.object({
      received: z.boolean().openapi({ example: true }),
    })
  ),
};

const webhookErrorResponse = (code: string, category: string, description: string) => ({
  description,
  content: jsonContent(
    z.object({
      error: z.string(),
      code: z.string().openapi({ example: code }),
      category: z.string().openapi({ example: category }),
      context: z.record(z.string(), z.unknown()).optional(),
    })
  ),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const yalidineChallengeRoute = defineRoute({
  method: "get",
  path: "/yalidine",
  auth: "public",
  tags: ["Webhooks"],
  summary: "Yalidine CRC challenge",
  description:
    "Yalidine sends a GET request with ?subscribe=…&crc_token=<value> to validate the endpoint " +
    "at creation, edit, and periodically. The endpoint echoes the crc_token as plain text. " +
    "If this fails, Yalidine disables the webhook automatically.",
  operationId: "yalidineChallenge",
  query: z.object({
    subscribe: z.string().optional().openapi({
      description: "Sent by Yalidine to initiate the CRC challenge",
    }),
    crc_token: z.string().optional().openapi({
      description: "Token echoed back in the (plain-text) response body",
    }),
  }),
  responses: {
    // Documented contract: crc_token echoed as text/plain. Without challenge
    // params the legacy handler answers a tiny {ok:true} JSON ack instead —
    // the dual return predates typed routes.
    200: {
      description: "CRC token echoed as plain text",
      content: {
        "text/plain": {
          schema: z.string().openapi({ example: "abc123token" }),
        },
      },
    },
  },
  handler: handleYalidineChallenge,
});

const yalidineWebhookRoute = defineRoute({
  method: "post",
  path: "/yalidine",
  auth: "public",
  tags: ["Webhooks"],
  summary: "Yalidine event delivery",
  description: `Receives webhook event batches from Yalidine (one event type per delivery, several events per batch; each \`event_id\` is its own idempotency key). The events are stored in the inbox and the request is answered at once — processing follows, so Yalidine's 10-second limit is always met — and an event that fails processing is retried with backoff.

**Which company:** the one whose webhook secret verifies \`X-Yalidine-Signature\` (HMAC-SHA256 of the raw body, hex), so several Yalidine companies never mix. A delivery no secret verifies is refused with **401** — unless the store has a single Yalidine company and it has no secret set (accepted, with a warning).

**Payload:** \`{ type: "parcel_created" | "parcel_edited" | "parcel_deleted" | "parcel_status_updated" | "parcel_payment_updated", events: [{ event_id, occurred_at, data }] }\`. Status updates and deletions move the shipment; payment updates are kept for settlement; the rest is ignored. An unreadable body is refused with **400**.`,
  operationId: "yalidineWebhook",
  headers: z.object({
    "X-Yalidine-Signature": z.string().optional().openapi({
      description: "HMAC-SHA256 of the raw request body, keyed with the webhook secret (hex). Required when a secret is stored.",
    }),
  }),
  responses: {
    200: receivedResponse,
    400: webhookErrorResponse("INVALID_WEBHOOK_PAYLOAD", "VALIDATION", "An unreadable delivery (INVALID_WEBHOOK_PAYLOAD)"),
    401: webhookErrorResponse("INVALID_WEBHOOK_PAYLOAD", "VALIDATION", "The signature matches no company (INVALID_WEBHOOK_PAYLOAD)"),
  },
  handler: handleYalidineWebhook,
});

const zrWebhookRoute = defineRoute({
  method: "post",
  path: "/zr_express",
  auth: "public",
  tags: ["Webhooks"],
  summary: "ZR Express event delivery",
  description: `Receives webhook events from ZR Express via Svix; \`svix-id\` is the idempotency key. The event is stored in the inbox and the request answered at once; processing follows, with retries.

**Which company:** the one whose \`whsec_\` secret verifies the Svix signature over the raw bytes; none verifying is a **401** — unless the store has a single ZR company and it has no secret set.

**Payload:** \`{ eventType: "parcel.state.updated" | "parcel.state.situation.created" | "parcel.isReturn.updated", occurredAt, data: ParcelWebhookDto }\`.`,
  operationId: "zrExpressWebhook",
  headers: z.object({
    "svix-id": z.string().openapi({ description: "Svix idempotency key" }),
    "svix-timestamp": z.string().openapi({ description: "Svix signed timestamp" }),
    "svix-signature": z.string().openapi({ description: "Svix HMAC-SHA256 signature" }),
  }),
  responses: {
    200: receivedResponse,
    400: webhookErrorResponse("INVALID_WEBHOOK_PAYLOAD", "VALIDATION", "An unreadable delivery (INVALID_WEBHOOK_PAYLOAD)"),
    401: webhookErrorResponse("INVALID_WEBHOOK_PAYLOAD", "VALIDATION", "The signature matches no company (INVALID_WEBHOOK_PAYLOAD)"),
  },
  handler: handleZrWebhook,
});

// ─── Router ───────────────────────────────────────────────────────────────────

const webhooksRouter = new OpenAPIHono<AppContext>();

webhooksRouter.openapi(yalidineChallengeRoute.route, yalidineChallengeRoute.handler);
webhooksRouter.openapi(yalidineWebhookRoute.route, yalidineWebhookRoute.handler);
webhooksRouter.openapi(zrWebhookRoute.route, zrWebhookRoute.handler);

export default webhooksRouter;
