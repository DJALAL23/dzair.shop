/**
 * Orders Routes
 *
 * CRUD, lifecycle transitions, the handoff to delivery, and shipment operations.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";

import * as handlers from "./handlers";
import * as statusTransitions from "./status-transitions";
import { handOffOrderRoute } from "../shipments/routes";

import {
  createOrderSchema,
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
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const listOrdersRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Orders"],
  summary: "List orders",
  operationId: "listOrders",
  query: orderFiltersSchema,
  responses: {
    200: {
      description:
        "Orders, newest first, with their delivery at a glance: the shipment's kind, carrier or driver and tracking number, the stage and whether it needs the merchant. `nextCursor` fetches the next page (null on the last one).",
      content: jsonContent(ListResponseSchema(OrderListItemSchema).extend({ nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` for the next page; null on the last page" }) })),
    },
  },
  handler: handlers.listOrders,
});

const getOrderRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.ORDERS_READ },
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

const createOrderRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.ORDERS_CREATE },
  tags: ["Orders"],
  summary: "Create order",
  description: `Creates a new order.

**Auto-customer creation:** If \`customerId\` is not found in the customers table (e.g. walk-in / manual entry), the customer is automatically created using \`customerName\`, \`phone\`, \`wilayaId\`, and \`address\`. Pass a client-generated UUID (e.g. \`crypto.randomUUID()\`) as \`customerId\` in this case.

**Inventory:** Products with \`trackInventory\` enabled will have their stock decremented automatically.

**Delivery fee:** auto-resolved from shipping profiles for online orders; offline/dashboard orders may pass an explicit \`deliveryFee\` override.

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
    "Permanently deletes the order and its records (lines, a closed shipment and its history), putting back the goods still out of stock (never those a customer received) and undoing the customer's count and spend, and a driver's credit for a delivery not settled. **409 ORDER_HAS_SHIPMENT** while the order's shipment is open — void it first; **409 ORDER_HAS_SETTLEMENT** once a driver payment settled its delivery.",
  operationId: "deleteOrder",
  params: IdParamSchema,
  responses: {
    200: {
      description: "Order deleted",
      content: jsonContent(MessageResponseSchema),
    },
    409: { description: "The order's shipment is open (ORDER_HAS_SHIPMENT), a driver payment settled its delivery (ORDER_HAS_SETTLEMENT), or the order changed meanwhile (ORDER_CHANGED)" },
  },
  handler: handlers.deleteOrder,
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
- \`unreachable\` → \`confirmed\` | \`cancelled\` (the customer did not answer; call again)
- \`preparing\` → \`ready\` | \`cancelled\`
- \`ready\` → \`cancelled\`; a ready order is handed off with \`POST /orders/{id}/shipment\`
- \`cancelled\` is final

Any other move returns \`400 INVALID_STATUS_TRANSITION\` with the allowed next statuses.

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

Refused (422) once the order is cancelled or its parcel came back — every remaining unit is already back in stock; checked in the same write, so neither can happen in between.`,
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











const router = new OpenAPIHono<AppContext>();

router.openapi(listOrdersRoute.route, listOrdersRoute.handler);

router.openapi(getOrderRoute.route, getOrderRoute.handler);
router.openapi(createOrderRoute.route, createOrderRoute.handler);
router.openapi(updateOrderRoute.route, updateOrderRoute.handler);
router.openapi(deleteOrderRoute.route, deleteOrderRoute.handler);
router.openapi(updateStatusRoute.route, updateStatusRoute.handler);
router.openapi(returnOrderProductRoute.route, returnOrderProductRoute.handler);
router.openapi(handOffOrderRoute.route, handOffOrderRoute.handler);

export default router;
