/**
 * Orders Routes
 *
 * CRUD, lifecycle transitions, the handoff to delivery, and shipment operations.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { guardOrderId } from "@/lib/order-visibility";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";

import * as handlers from "./handlers";
import * as statusTransitions from "./status-transitions";
import { handOffOrderRoute } from "../shipments/routes";
import * as team from "../team/handlers";
import { assignOrdersSchema, callbackSchema } from "../team/validation";
import { AssignmentResultSchema } from "@/openapi/schemas/team";

import {
  createOrderSchema,
  deliveryQuoteSchema,
  updateOrderSchema,
  updateOrderStatusSchema,
  returnOrderProductSchema,
  orderFiltersSchema,
} from "./validation";

import {
  SuccessResponseSchema,
  SuccessWithMessageSchema,
  MessageResponseSchema,
  ListResponseSchema,
  IdParamSchema,
  OrderListItemSchema,
  OrderDetailSchema,
  OrderCreatedDataSchema,
  ReturnProductDataSchema,
  OrderRemovalSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const listOrdersRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { anyOf: [SCOPES.ORDERS_READ, SCOPES.ORDERS_READ_ASSIGNED] },
  tags: ["Orders"],
  summary: "List orders",
  operationId: "listOrders",
  query: orderFiltersSchema,
  responses: {
    200: {
      description:
        "Orders, newest first (archived ones left out unless `archived` says otherwise), with their delivery at a glance: the shipment's kind, carrier or driver and tracking number, the stage and whether it needs the merchant. `nextCursor` fetches the next page (null on the last one).",
      content: jsonContent(ListResponseSchema(OrderListItemSchema).extend({ nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` for the next page; null on the last page" }) })),
    },
  },
  handler: handlers.listOrders,
});

const getOrderRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { anyOf: [SCOPES.ORDERS_READ, SCOPES.ORDERS_READ_ASSIGNED] },
  tags: ["Orders"],
  summary: "Get order",
  description: "Returns full order detail including products and status history.",
  operationId: "getOrder",
  params: IdParamSchema,
  responses: {
    200: {
      description: "Order details",
      content: jsonContent(SuccessResponseSchema(OrderDetailSchema)),
    },
  },
  handler: handlers.getOrder,
});

const deliveryQuoteRoute = defineRoute({
  method: "post",
  path: "/delivery-quote",
  auth: { scope: SCOPES.ORDERS_CREATE },
  tags: ["Orders"],
  summary: "Quote an order's delivery",
  description: `What delivery would cost on an order being entered, decided as the storefront checkout decides it — the fee \`POST /orders\` charges when no fee is typed — and why it is free when it is: \`{ by: "threshold", threshold }\` (the store's free-delivery amount) or \`{ by: "offer", offerId, offerName }\`. \`{ available: false }\` where the store does not deliver. A read: nothing is written.`,
  operationId: "quoteOrderDelivery",
  body: deliveryQuoteSchema,
  responses: {
    200: {
      description: "The quote",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.union([
            z.object({ available: z.literal(false) }),
            z.object({
              available: z.literal(true),
              rate: z.number().openapi({ description: "The store's rate there, before anything makes it free" }),
              fee: z.number().openapi({ description: "What the order charges for delivery" }),
              free: z
                .union([
                  z.object({ by: z.literal("threshold"), threshold: z.number() }),
                  z.object({ by: z.literal("offer"), offerId: z.string(), offerName: z.string().nullable() }),
                ])
                .nullable(),
            }),
          ]),
        }),
      ),
    },
  },
  handler: handlers.quoteDelivery,
});

const createOrderRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.ORDERS_CREATE },
  tags: ["Orders"],
  summary: "Create order",
  description: `Creates a new order.

**Auto-customer creation:** If \`customerId\` is not found in the customers table (e.g. walk-in / manual entry), the customer is automatically created using \`customerName\`, \`phone\`, \`wilayaId\`, and \`address\`. Pass a client-generated UUID (e.g. \`crypto.randomUUID()\`) as \`customerId\` in this case.

**Inventory:** Products with \`trackInventory\` enabled will have their stock decremented automatically.

**Delivery fee:** decided as the storefront checkout decides it (\`POST /orders/delivery-quote\` shows it): every product's shipping profile, the dearest winning; a commune's own price; free at the store's free-delivery amount; free by an offer for a basket of its product alone, which the order records (\`deliveryOfferId\`). An offline order may pass an explicit \`deliveryFee\`, which is then kept as typed. Where the store does not deliver, an online order is refused (422 DELIVERY_NOT_AVAILABLE).

**Delivery** is chosen later, when the ready order is handed to a carrier or a driver (\`POST /orders/{id}/shipment\`).`,
  operationId: "createOrder",
  body: createOrderSchema,
  responses: {
    201: {
      description: "Order created successfully",
      content: jsonContent(SuccessWithMessageSchema(OrderCreatedDataSchema)),
    },
  },
  handler: handlers.createOrder,
});

const updateOrderRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Update order",
  description: `Partially edits an order's customer and destination fields: \`customerName\`, \`phone\`, \`customerEmail\`, \`wilayaId\`, \`communeId\`, \`city\`, \`address\`, \`deliveryType\`, \`notes\`. All fields optional — omitted fields stay untouched.

This is how a merchant records an address collected over the phone when the checkout hid the address field.

The linked customer record is updated in the same operation with the fields this request changes (name, phone, wilaya/commune, address) — an order and its customer never disagree on contact details. If the corrected phone already belongs to a different customer record, the order is re-pointed to that record instead of overwriting its phone. \`customerEmail\` is stored on the order only.

\`customerEmail\` / \`address\`: an empty (or whitespace) value clears the field; a value is stored trimmed (email also lower-cased), matching POST /orders.

**Rejected with 409 ORDER_HAS_SHIPMENT** when the order has a shipment and the edit touches what the parcel carries (name, phone, wilaya, commune, city, address, delivery type) — change those through PATCH /shipments/{id}; the email and notes still change. **Rejected with 422** for a legacy order that already has a tracking number, or one in a terminal state (returned/cancelled). **Rejected with 400 MISSING_ADDRESS** when the edit would leave a home delivery without a street address. Wilaya/commune are checked against the reference tables (400 MISSING_WILAYA_COMMUNE).`,
  operationId: "updateOrder",
  params: IdParamSchema,
  body: updateOrderSchema,
  responses: {
    200: {
      description: "Order updated — returns the refreshed order detail",
      content: jsonContent(SuccessWithMessageSchema(OrderDetailSchema)),
    },
    400: {
      description:
        "Validation error — bad phone/email, home delivery left without an address (MISSING_ADDRESS), or unknown wilaya/commune (MISSING_WILAYA_COMMUNE)",
    },
    404: {
      description: "Order not found",
    },
    409: {
      description: "The order has a shipment and the edit touches what the parcel carries (ORDER_HAS_SHIPMENT)",
    },
    422: {
      description: "The order is cancelled (INVALID_STATUS_TRANSITION)",
    },
  },
  handler: handlers.updateOrder,
});

const deleteOrderRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.ORDERS_DELETE },
  tags: ["Orders"],
  summary: "Delete order",
  description:
    "Permanently deletes an order never handed to delivery, in any status: the goods still out of stock go back, the customer's order count and spend are undone, and its lines, history, reviews and logs go with it. **409 ORDER_HAS_SHIPMENT** once it has a shipment — its parcel, the driver's cash and the carrier's records rest on it; archive it when its delivery has ended (`POST /orders/{id}/archive`), or void the shipment first. The database refuses it too.",
  operationId: "deleteOrder",
  params: IdParamSchema,
  responses: {
    200: {
      description: "Order deleted",
      content: jsonContent(MessageResponseSchema),
    },
    409: { description: "The order has a shipment (ORDER_HAS_SHIPMENT), or it changed meanwhile (ORDER_CHANGED)" },
  },
  handler: handlers.deleteOrder,
});

const orderRemovalRoute = defineRoute({
  method: "get",
  path: "/{id}/removal",
  auth: { anyOf: [SCOPES.ORDERS_READ, SCOPES.ORDERS_READ_ASSIGNED] },
  tags: ["Orders"],
  summary: "What clearing an order away does",
  description:
    "Whether the order can be deleted (never handed to delivery) or archived (finished: cancelled, or its shipment delivered, returned or cancelled), and what deleting it would undo — read before asking the merchant to confirm.",
  operationId: "getOrderRemoval",
  params: IdParamSchema,
  responses: {
    200: { description: "The order's removal options", content: jsonContent(SuccessResponseSchema(OrderRemovalSchema)) },
  },
  handler: handlers.getOrderRemoval,
});

const ArchivedDataSchema = SuccessResponseSchema(z.object({ archivedAt: z.string().datetime().nullable() }));

const archiveOrderRoute = defineRoute({
  method: "post",
  path: "/{id}/archive",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Archive order",
  description:
    "Takes a finished order — cancelled, or its shipment delivered, returned or cancelled — out of the working lists and their counts. It still counts in the analytics and the customer's history, and can be restored. Archiving it again keeps the first date. **409 ORDER_NOT_FINISHED** before then.",
  operationId: "archiveOrder",
  params: IdParamSchema,
  responses: {
    200: { description: "Archived", content: jsonContent(ArchivedDataSchema) },
    409: { description: "The order is not finished yet (ORDER_NOT_FINISHED)" },
  },
  handler: handlers.archiveOrder,
});

const unarchiveOrderRoute = defineRoute({
  method: "post",
  path: "/{id}/unarchive",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Restore an archived order",
  description: "Brings an archived order back to the working lists.",
  operationId: "unarchiveOrder",
  params: IdParamSchema,
  responses: {
    200: { description: "Restored", content: jsonContent(ArchivedDataSchema) },
  },
  handler: handlers.unarchiveOrder,
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

const updateStatusRoute = defineRoute({
  method: "patch",
  path: "/{id}/status",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Update order status",
  description: `Moves the order's processing and appends a record to its status history (\`cod-shared/orders/lifecycle.ts\`):

- \`new\` → \`confirmed\` | \`unreachable\` | \`cancelled\`
- \`confirmed\` → \`preparing\` | \`ready\` | \`unreachable\` | \`cancelled\`
- \`unreachable\` → \`confirmed\` | \`unreachable\` | \`cancelled\` (the customer did not answer: each further call without an answer is one more move to \`unreachable\`)
- \`preparing\` → \`ready\` | \`cancelled\`
- \`ready\` → \`cancelled\`; a ready order is handed off with \`POST /orders/{id}/shipment\`
- \`cancelled\` is final

Any other move returns \`400 INVALID_STATUS_TRANSITION\` with the allowed next statuses.

**Calls without an answer:** each move to \`unreachable\` adds one to the order's \`unansweredCalls\` (Call 1, Call 2, Call 3…); nothing else changes it, and nothing cancels the order for you.

**The order as you saw it:** send \`seen\` (its \`status\` and \`unansweredCalls\` as you read them) and the move applies only while the order still is so: otherwise \`409 ORDER_CHANGED\`, nothing is written, and you read the order again. One press on No answer then counts one call, and a move on an order someone else confirmed or cancelled meanwhile is refused rather than applied.

**Side effects:** \`confirmed\` starts the Meta CAPI confirmed stage (when the store tracks it); \`cancelled\` restores inventory for products with \`trackInventory\` and rolls back the customer's spend. Delivery and return are the shipment's milestones, with their own effects.

Each effect applies exactly once, even when the same change is sent twice at once. **An order with a shipment has no status change** (409 ORDER_HAS_SHIPMENT): its delivery is the shipment's, and cancelling it means voiding the shipment first.`,
  operationId: "updateOrderStatus",
  params: IdParamSchema,
  body: updateOrderStatusSchema,
  responses: {
    200: {
      description: "Status updated",
      content: jsonContent(MessageResponseSchema),
    },
    400: {
      description:
        "Unknown status value (VALIDATION_FAILED) or transition not allowed by the flow guard (INVALID_STATUS_TRANSITION with currentStatus/targetStatus/allowedTransitions context)",
    },
    409: { description: "The order has a shipment (ORDER_HAS_SHIPMENT), or it changed meanwhile (ORDER_CHANGED)" },
  },
  handler: statusTransitions.updateStatus,
});

const returnOrderProductRoute = defineRoute({
  method: "patch",
  path: "/{id}/products/{productLineId}/return",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Record a product line return",
  description: `Records how many units on a single order line the customer refused at the door. Used for the Algerian "open the box at delivery" workflow where a customer may accept part of an order and return the rest.

The server computes the line status ("fulfilled" | "partially_returned" | "returned") from returnedQuantity vs. the line quantity, restocks the delta (repeated calls are idempotent), and logs an ORDER_RETURNED stock movement.

Only on a **delivered** order: the customer opened the parcel at the door and kept part of it. Before delivery nothing has been refused (422 ORDER_NOT_DELIVERED) — a parcel refused whole comes back as a return, and its stock with it.

Refused (422) once the order is cancelled or its parcel came back — every remaining unit is already back in stock. Both are checked in the same write, so neither can happen in between.`,
  operationId: "returnOrderProduct",
  params: IdParamSchema.extend({
    productLineId: z.string().openapi({ description: "Order product line ID" }),
  }),
  body: returnOrderProductSchema,
  responses: {
    200: {
      description: "Return recorded",
      content: jsonContent(SuccessWithMessageSchema(ReturnProductDataSchema)),
    },
    400: {
      description: "Validation error (VALIDATION_FAILED / VALUE_OUT_OF_RANGE)",
    },
    404: { description: "Order or order line not found" },
    409: { description: "The line changed meanwhile (ORDER_CHANGED)" },
    422: { description: "The order is cancelled or its parcel came back (INVALID_STATUS_TRANSITION)" },
  },
  handler: handlers.returnOrderProduct,
});











// ─── Confirmation team ────────────────────────────────────────────────────────

const assignOrdersRoute = defineRoute({
  method: "post",
  path: "/assign",
  auth: { scope: SCOPES.TEAM_MANAGE },
  tags: ["Orders", "Confirmation team"],
  summary: "Give orders to a team member, to nobody, or by the store's rule",
  description:
    "Each order moves only while it is still with whoever it was with when read, and records `order.assigned` (or `order.unassigned`). An order already with that member is left as it is. `to: \"rule\"` shares each one out by the store's rule, to someone other than who has it. One result per order, in the order given; a manager's choice also resets the order's take-back count.",
  operationId: "assignOrders",
  body: assignOrdersSchema,
  responses: {
    200: { description: "One result per order", content: jsonContent(SuccessResponseSchema(z.array(AssignmentResultSchema))) },
    404: { description: "No such member (USER_NOT_FOUND)" },
    422: { description: "The member's account is inactive (USER_INACTIVE), they are not on the confirmation team (NOT_TEAM_MEMBER), or they cannot see orders (NO_ORDER_ACCESS)" },
  },
  handler: team.assign,
});

const callbackRoute = defineRoute({
  method: "put",
  path: "/{id}/callback",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders", "Confirmation team"],
  summary: "Set when to call the customer back",
  description: "On an order still waiting (new, or the customer not reached); `at: null` clears it. It ends by itself once the order is confirmed or cancelled, and an order with a callback is never taken back from its member.",
  operationId: "setOrderCallback",
  params: IdParamSchema,
  body: callbackSchema,
  responses: {
    200: { description: "The callback", content: jsonContent(SuccessResponseSchema(z.object({ callbackAt: z.string().nullable() }))) },
    404: { description: "Order not found" },
    422: { description: "The order no longer waits (ORDER_NOT_WAITING)" },
  },
  handler: team.setCallback,
});

const router = new OpenAPIHono<AppContext>();

router.use("/:id/*", guardOrderId());

router.openapi(listOrdersRoute.route, listOrdersRoute.handler);

router.openapi(deliveryQuoteRoute.route, deliveryQuoteRoute.handler);
router.openapi(getOrderRoute.route, getOrderRoute.handler);
router.openapi(createOrderRoute.route, createOrderRoute.handler);
router.openapi(updateOrderRoute.route, updateOrderRoute.handler);
router.openapi(deleteOrderRoute.route, deleteOrderRoute.handler);
router.openapi(orderRemovalRoute.route, orderRemovalRoute.handler);
router.openapi(archiveOrderRoute.route, archiveOrderRoute.handler);
router.openapi(unarchiveOrderRoute.route, unarchiveOrderRoute.handler);
router.openapi(updateStatusRoute.route, updateStatusRoute.handler);
router.openapi(returnOrderProductRoute.route, returnOrderProductRoute.handler);
router.openapi(handOffOrderRoute.route, handOffOrderRoute.handler);
router.openapi(assignOrdersRoute.route, assignOrdersRoute.handler);
router.openapi(callbackRoute.route, callbackRoute.handler);

export default router;
