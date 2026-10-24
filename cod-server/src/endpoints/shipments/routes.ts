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
import {
  BulkHandoffDataSchema,
  CarrierRemarkSchema,
  HandoffResultSchema,
  ResolveResultSchema,
  ShipmentOperationResultSchema,
  ShipmentSchema,
} from "@/openapi/schemas/shipments";
import * as handlers from "./handlers";
import {
  bulkCarrierHandoffSchema,
  bulkDriverHandoffSchema,
  orderHandoffSchema,
  merchantReportSchema,
  remarkSchema,
  resolveHandoffSchema,
  updateParcelSchema,
  validateShipmentSchema,
} from "./validation";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const HANDOFF_OUTCOMES = `Only a **ready** order with no shipment can be handed off. The shipment is reserved before the carrier is called, so a second dispatch of the same order is refused (409 ORDER_HAS_SHIPMENT) and never reaches the carrier.

What the carrier's answer proves decides the outcome:
- **accepted** — the carrier created the parcel. When the company auto-validates and the carrier needs a separate validation, it is validated too; a refused validation is reported in \`validationError\` and kept in the shipment's history.
- **refused** — the carrier refused it, the credentials failed, it was throttled, or it could not be reached: nothing was created and the order is ready again.
- **unknown** — the carrier may have created it (a timeout, a server error). It is never sent again automatically: resolve it with \`POST /shipments/{id}/resolve\`.`;

const DRIVER_HANDOFF = `The store's own driver has no carrier to call: the shipment is accepted at once, and the driver's fee for the order's wilaya (0 where none is set) is frozen on it. The driver is not a carrier and has no stop desks: the shipment is always home delivery to the order's street address — an order whose customer chose a stop desk keeps that choice and its price, and the driver brings it to the door (\`deliveryType: "stop_desk"\` is refused). Only a **ready** order with no shipment and a street address (400 MISSING_ADDRESS), and a driver who is not inactive. The driver's progress is then reported with \`POST /shipments/{id}/events\`.`;

export const handOffOrderRoute = defineRoute({
  method: "post",
  path: "/{id}/shipment",
  auth: { anyOf: [SCOPES.DELIVERY_DISPATCH, SCOPES.ORDERS_ASSIGN] },
  tags: ["Shipments"],
  summary: "Hand an order to a carrier or to a driver",
  description: `\`kind: "carrier"\` hands the order to a delivery company (needs ${SCOPES.DELIVERY_DISPATCH}); \`kind: "driver"\` gives it to the store's driver (needs ${SCOPES.ORDERS_ASSIGN}).

**Carrier.** ${HANDOFF_OUTCOMES}

**Driver.** ${DRIVER_HANDOFF}`,
  operationId: "handOffOrder",
  params: IdParamSchema,
  body: orderHandoffSchema,
  responses: {
    201: { description: "The carrier has the parcel, or the driver has the order", content: jsonContent(SuccessResponseSchema(HandoffResultSchema)) },
    202: { description: "The carrier's outcome is unknown; resolve it", content: jsonContent(SuccessResponseSchema(HandoffResultSchema)) },
    400: { description: "The order's address, wilaya/commune or desk is incomplete, or the company is not connected" },
    403: { description: "Missing the permission this kind of handoff needs" },
    404: { description: "Order, delivery company or driver not found" },
    409: { description: "The order already has a shipment, or the company's carrier settings are incomplete" },
    422: { description: "The order is not ready, the driver is inactive, the company does not offer the delivery type, the value is over the carrier's ceiling, or the carrier refused it" },
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

const driverBulkHandoffRoute = defineRoute({
  method: "post",
  path: "/driver-bulk",
  auth: { scope: SCOPES.ORDERS_ASSIGN },
  tags: ["Shipments"],
  summary: "Give many orders to a driver",
  description: `The same handoff as \`POST /orders/{id}/shipment\` with \`kind: "driver"\`, for up to 100 orders and one driver, with one result per order: \`accepted\` or \`refused\` (never \`unknown\`).

${DRIVER_HANDOFF}`,
  operationId: "handOffOrdersToDriver",
  body: bulkDriverHandoffSchema,
  responses: {
    200: { description: "One result per order", content: jsonContent(SuccessResponseSchema(BulkHandoffDataSchema)) },
    404: { description: "Driver not found" },
    422: { description: "The driver is inactive" },
  },
  handler: handlers.handOffDriverBulk,
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

// ─── Operations on a shipment ─────────────────────────────────────────────────

const OPERATION_REFUSALS = {
  404: { description: "Shipment not found" },
  409: { description: "Not now: the parcel is not accepted yet, already validated, on its way, or closed (the shipment's `actions` say what is possible)" },
  422: { description: "The carrier does not support this, or refused it" },
  429: { description: "The carrier is throttling" },
  502: { description: "The carrier could not be reached, or did not make its answer clear" },
};
const operationResult = { 200: { description: "The shipment after the operation", content: jsonContent(SuccessResponseSchema(ShipmentOperationResultSchema)) }, ...OPERATION_REFUSALS };

const validateRoute = defineRoute({
  method: "post",
  path: "/{id}/validate",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Validate a parcel at the carrier",
  description: "For carriers that hold a created parcel until it is validated (EcoTrack, NOEST). After validation it can no longer be edited or cancelled.",
  operationId: "validateShipment",
  params: IdParamSchema,
  body: validateShipmentSchema,
  responses: operationResult,
  handler: handlers.validate,
});

const updateRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Edit a parcel at the carrier",
  description: `Changes the customer's details, the destination, the cash to collect, the weight or fragility — at the carrier first, then in CodFlow: the order's contact and destination (with its customer, like an order edit) and the shipment's cash, weight and fragility. Only before the parcel leaves (and, at a carrier that validates separately, before validation). A new destination needs both \`wilayaId\` and \`communeId\`.`,
  operationId: "updateShipment",
  params: IdParamSchema,
  body: updateParcelSchema,
  responses: { ...operationResult, 400: { description: "Nothing to change, an incomplete destination, or a home delivery left without an address" } },
  handler: handlers.update,
});

const voidRoute = defineRoute({
  method: "post",
  path: "/{id}/void",
  auth: { anyOf: [SCOPES.DELIVERY_DISPATCH, SCOPES.ORDERS_ASSIGN] },
  tags: ["Shipments"],
  summary: "Void a shipment",
  description: `Undo a shipment that never reached the customer, so the order can be handed off again: a carrier parcel is cancelled at the carrier first (unless the carrier already cancelled it); a driver's order is taken back from the driver. Refused once it is out for delivery. A carrier shipment needs ${SCOPES.DELIVERY_DISPATCH}, a driver's ${SCOPES.ORDERS_ASSIGN}.`,
  operationId: "voidShipment",
  params: IdParamSchema,
  responses: {
    200: { description: "Voided; the order is ready to hand off again", content: jsonContent(SuccessResponseSchema(z.object({ orderId: z.string() }))) },
    ...OPERATION_REFUSALS,
    403: { description: "Missing the permission this shipment's kind needs" },
  },
  handler: handlers.voidOne,
});

const listRemarksRoute = defineRoute({
  method: "get",
  path: "/{id}/remarks",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Shipments"],
  summary: "Read the parcel's remarks at the carrier",
  operationId: "listShipmentRemarks",
  params: IdParamSchema,
  responses: { 200: { description: "Remarks from the merchant and the courier", content: jsonContent(SuccessResponseSchema(z.array(CarrierRemarkSchema))) }, ...OPERATION_REFUSALS },
  handler: handlers.remarks,
});

const addRemarkRoute = defineRoute({
  method: "post",
  path: "/{id}/remarks",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Add a remark for the courier",
  operationId: "addShipmentRemark",
  params: IdParamSchema,
  body: remarkSchema,
  responses: operationResult,
  handler: handlers.addRemark,
});

const labelRoute = defineRoute({
  method: "get",
  path: "/{id}/label",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Shipments"],
  summary: "The parcel's label",
  description: "Fetched from the carrier for the merchant: carrier labels sit behind the company's credentials or an expiring link.",
  operationId: "getShipmentLabel",
  params: IdParamSchema,
  responses: {
    200: { description: "The label", content: { "application/pdf": { schema: z.string().openapi({ format: "binary", type: "string" }) } } },
    ...OPERATION_REFUSALS,
  },
  handler: handlers.label,
});

const askReturnRoute = defineRoute({
  method: "post",
  path: "/{id}/ask-return",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Ask the carrier to return the parcel",
  description: "A request the courier may decline; it is noted in the history and changes nothing until the carrier reports the return.",
  operationId: "askShipmentReturn",
  params: IdParamSchema,
  responses: operationResult,
  handler: handlers.askReturn,
});

const requestNewAttemptRoute = defineRoute({
  method: "post",
  path: "/{id}/request-new-attempt",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Ask the carrier to try delivering again",
  description: "After a failed attempt (NOEST). Noted in the history.",
  operationId: "requestShipmentNewAttempt",
  params: IdParamSchema,
  responses: operationResult,
  handler: handlers.requestNewAttempt,
});

const confirmReturnRoute = defineRoute({
  method: "post",
  path: "/{id}/confirm-return",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Confirm at the carrier that the return reached you",
  description: "EcoTrack's return confirmation, then the return is recorded: the goods go back in stock and the customer's spend is rolled back.",
  operationId: "confirmShipmentReturn",
  params: IdParamSchema,
  responses: operationResult,
  handler: handlers.confirmReturn,
});

const syncRoute = defineRoute({
  method: "post",
  path: "/{id}/sync",
  auth: { scope: SCOPES.DELIVERY_DISPATCH },
  tags: ["Shipments"],
  summary: "Read the carrier's history now",
  description: "Records every status the carrier reports that the shipment does not have yet; a status already recorded (by webhook or an earlier sync) is not recorded twice.",
  operationId: "syncShipment",
  params: IdParamSchema,
  responses: operationResult,
  handler: handlers.sync,
});

const reportRoute = defineRoute({
  method: "post",
  path: "/{id}/events",
  auth: { anyOf: [SCOPES.DELIVERY_DISPATCH, SCOPES.ORDERS_ASSIGN] },
  tags: ["Shipments"],
  summary: "Report what happened",
  description: `What the merchant saw. On a driver's shipment: the driver's progress (\`out_for_delivery\`, \`failed_attempt\`, \`delivered\`, \`returned\`) — needs ${SCOPES.ORDERS_ASSIGN}. On a carrier shipment only \`returned\`: the goods are back with the merchant (the carrier alone can say a parcel was delivered) — needs ${SCOPES.DELIVERY_DISPATCH}.`,
  operationId: "reportShipmentEvent",
  params: IdParamSchema,
  body: merchantReportSchema,
  responses: { ...operationResult, 403: { description: "Missing the permission this shipment's kind needs" } },
  handler: handlers.report,
});

const router = new OpenAPIHono<AppContext>();

// The bulk routes before /{id}, so "bulk" is never read as an id.
router.openapi(bulkHandoffRoute.route, bulkHandoffRoute.handler);
router.openapi(driverBulkHandoffRoute.route, driverBulkHandoffRoute.handler);
router.openapi(getShipmentRoute.route, getShipmentRoute.handler);
router.openapi(resolveRoute.route, resolveRoute.handler);
for (const route of [validateRoute, updateRoute, voidRoute, listRemarksRoute, addRemarkRoute, labelRoute, askReturnRoute, requestNewAttemptRoute, confirmReturnRoute, syncRoute, reportRoute]) {
  router.openapi(route.route, route.handler);
}

export default router;
