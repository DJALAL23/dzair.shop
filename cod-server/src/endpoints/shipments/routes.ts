/**
 * Shipment routes (ADR 0006). An order is handed off through
 * `POST /orders/{id}/shipment` (defined here, mounted on the orders router);
 * everything about the shipment itself lives under `/shipments`.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { IdParamSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { BulkHandoffDataSchema, HandoffResultSchema, ResolveResultSchema, ShipmentSchema } from "@/openapi/schemas/shipments";
import * as handlers from "./handlers";
import { bulkCarrierHandoffSchema, carrierHandoffSchema, resolveHandoffSchema } from "./validation";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const HANDOFF_OUTCOMES = `Only a **ready** order with no shipment can be handed off. The shipment is reserved before the carrier is called, so a second dispatch of the same order is refused (409 ORDER_HAS_SHIPMENT) and never reaches the carrier.

What the carrier's answer proves decides the outcome:
- **accepted** — the carrier created the parcel. When the company auto-validates and the carrier needs a separate validation, it is validated too; a refused validation is reported in \`validationError\` and kept in the shipment's history.
- **refused** — the carrier refused it, the credentials failed, it was throttled, or it could not be reached: nothing was created and the order is ready again.
- **unknown** — the carrier may have created it (a timeout, a server error). It is never sent again automatically: resolve it with \`POST /shipments/{id}/resolve\`.`;

export const handOffOrderRoute = defineRoute({
  method: "post",
  path: "/{id}/shipment",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Hand an order to a carrier",
  description: HANDOFF_OUTCOMES,
  operationId: "handOffOrder",
  params: IdParamSchema,
  body: carrierHandoffSchema,
  responses: {
    201: { description: "The carrier has the parcel", content: jsonContent(SuccessResponseSchema(HandoffResultSchema)) },
    202: { description: "The outcome is unknown; resolve it", content: jsonContent(SuccessResponseSchema(HandoffResultSchema)) },
    400: { description: "The order's address, wilaya/commune or desk is incomplete, or the company is not connected" },
    404: { description: "Order or delivery company not found" },
    409: { description: "The order already has a shipment, or the company's carrier settings are incomplete" },
    422: { description: "The order is not ready, the company does not offer the delivery type, the value is over the carrier's ceiling, or the carrier refused it" },
    429: { description: "The carrier is throttling; nothing was created" },
    502: { description: "The carrier could not be reached; nothing was created" },
  },
  handler: handlers.handOffOrder,
});

const bulkHandoffRoute = defineRoute({
  method: "post",
  path: "/bulk",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Hand many orders to a carrier",
  description: `The same handoff as \`POST /orders/{id}/shipment\`, for up to 100 orders and one company, with one result per order. The carrier's bulk creation is used when it has one.

${HANDOFF_OUTCOMES}`,
  operationId: "handOffOrders",
  body: bulkCarrierHandoffSchema,
  responses: {
    200: { description: "One result per order", content: jsonContent(SuccessResponseSchema(BulkHandoffDataSchema)) },
    404: { description: "Delivery company not found" },
  },
  handler: handlers.handOffBulk,
});

const getShipmentRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Shipments"],
  summary: "Get a shipment",
  description: "The shipment with its full history (carrier statuses as reported, and what CodFlow concluded from them) and the actions available now.",
  operationId: "getShipment",
  params: IdParamSchema,
  responses: {
    200: { description: "The shipment", content: jsonContent(SuccessResponseSchema(ShipmentSchema)) },
    404: { description: "Shipment not found" },
  },
  handler: handlers.getShipmentDetail,
});

const resolveRoute = defineRoute({
  method: "post",
  path: "/{id}/resolve",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Resolve a handoff whose outcome is unknown",
  description: `- \`lookup\` — ask the carrier for a parcel with this order's number (carriers that support it). \`not_found\` leaves the shipment unresolved.
- \`attach\` — the parcel was found at the carrier: record its tracking number.
- \`release\` — the carrier has no parcel: the shipment is removed and the order is ready to hand off again.`,
  operationId: "resolveShipmentHandoff",
  params: IdParamSchema,
  body: resolveHandoffSchema,
  responses: {
    200: { description: "How it was resolved", content: jsonContent(SuccessResponseSchema(ResolveResultSchema)) },
    404: { description: "Shipment not found" },
    409: { description: "The handoff is not unknown, or the parcel already belongs to another shipment" },
    422: { description: "The carrier cannot look parcels up by order number" },
  },
  handler: handlers.resolveShipmentHandoff,
});

const router = new OpenAPIHono<AppContext>();

// /bulk before /{id}, so "bulk" is never read as an id.
router.openapi(bulkHandoffRoute.route, bulkHandoffRoute.handler);
router.openapi(getShipmentRoute.route, getShipmentRoute.handler);
router.openapi(resolveRoute.route, resolveRoute.handler);

export default router;
