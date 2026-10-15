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
  assignDriverSchema,
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
        "List of orders (each item includes wilaya/commune/driverName joins plus hasReview and lastUpdatedBy)",
      content: jsonContent(ListResponseSchema(OrderListItemSchema)),
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

**companyId:** If provided, the delivery company must exist — returns 404 if not found.`,
  operationId: "createOrder",
  body: createOrderSchema,
  responses: {
    201: {
      description: "Order created successfully",
      content: jsonContent(SuccessWithMessageSchema(OrderCreatedDataSchema)),
    },
    404: {
      description: "Delivery company not found when companyId provided",
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

**Rejected with 422** when the order already has a tracking number (edit the shipment via PATCH /orders/{id}/update-shipment instead) or is in a terminal state (returned/cancelled). **Rejected with 400 MISSING_ADDRESS** when the edit would leave a home delivery without a street address. Wilaya/commune are checked against the reference tables (400 MISSING_WILAYA_COMMUNE).`,
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
    422: {
      description:
        "Order already dispatched (ORDER_ALREADY_DISPATCHED) or terminal (INVALID_STATUS_TRANSITION)",
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
    "Permanently deletes the order and all child records (order products, shipments) from the database.",
  operationId: "deleteOrder",
  params: IdParamSchema,
  responses: {
    200: {
      description: "Order deleted",
      content: jsonContent(MessageResponseSchema),
    },
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
  description: `Updates the order status and appends a record to status history.

**Main flow:** \`new\` → \`confirmed\` → \`preparing\` → \`ready\` → (\`assigned\` | \`dispatched\`) → \`out_for_delivery\` → \`delivered\` / \`returned\`

**Branching statuses:**
- \`unreachable\`: customer didn't answer — parks the order. Can retry back to \`confirmed\` or cancel

**Transition guard:** Only forward moves in the flow are accepted. Invalid moves (e.g. \`delivered → new\`, \`cancelled → preparing\`) return \`400 INVALID_STATUS_TRANSITION\` with the list of allowed next statuses.

**Side effects:**
- **delivered**: sets \`deliveryTime\`; increments driver's \`totalDelivered\` and \`totalEarnings\` if assigned
- **cancelled / returned**: restores inventory for products with \`trackInventory\` enabled (double-cancel/return is safe)
- **delivered**: fires the Meta CAPI Purchase workflow when the store has tracking enabled`,
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
  },
  handler: statusTransitions.updateStatus,
});

const assignDriverRoute = defineRoute({
  method: "patch",
  path: "/{id}/assign-driver",
  auth: { scope: SCOPES.ORDERS_ASSIGN },
  tags: ["Orders"],
  summary: "Assign driver to order",
  description: `Assigns a driver for manual delivery.

**Business rules — returns 422 if:**
- The order already has a tracking number (dispatched to a company)
- The order's \`deliveryMethod\` is \`"company"\`
- The order status is \`out_for_delivery\`, \`delivered\`, \`returned\`, or \`cancelled\`
- The driver does not exist (404)`,
  operationId: "assignDriver",
  params: IdParamSchema,
  body: assignDriverSchema,
  responses: {
    200: {
      description: "Driver assigned",
      content: jsonContent(MessageResponseSchema),
    },
    422: {
      description:
        "Business rule violation — already dispatched / company-assigned / locked status",
    },
  },
  handler: statusTransitions.assignDriver,
});

const unassignDriverRoute = defineRoute({
  method: "patch",
  path: "/{id}/unassign",
  auth: { scope: SCOPES.ORDERS_ASSIGN },
  tags: ["Orders"],
  summary: "Unassign driver from order",
  description: `Removes the driver currently assigned to an order. Clears driverId and driverFee, resets deliveryMethod to "unassigned", and rolls the status back from "assigned" → "ready" when applicable.

**Rejected when:**
- order has no driver assigned
- order has already progressed past dispatch (out_for_delivery, delivered, returned, cancelled) — at that point clearing the driver would erase payroll/handoff history.`,
  operationId: "unassignDriver",
  params: IdParamSchema,
  responses: {
    200: {
      description: "Driver unassigned",
      content: jsonContent(MessageResponseSchema),
    },
    422: {
      description: "Order has no driver assigned, or status is locked",
    },
  },
  handler: statusTransitions.unassignDriver,
});

const returnOrderProductRoute = defineRoute({
  method: "patch",
  path: "/{id}/products/{productLineId}/return",
  auth: { scope: SCOPES.ORDERS_UPDATE },
  tags: ["Orders"],
  summary: "Record a product line return",
  description: `Records how many units on a single order line the customer refused at the door. Used for the Algerian "open the box at delivery" workflow where a customer may accept part of an order and return the rest.

The server computes the line status ("fulfilled" | "partially_returned" | "returned") from returnedQuantity vs. the line quantity, restocks the delta (repeated calls are idempotent), and logs an ORDER_RETURNED stock movement.

Rejected with 422 while the overall order is already \`returned\` or \`cancelled\` — stock was already reconciled.`,
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
    422: {
      description:
        "Order is in a terminal state (returned/cancelled) — returns already reconciled",
    },
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
router.openapi(assignDriverRoute.route, assignDriverRoute.handler);
router.openapi(unassignDriverRoute.route, unassignDriverRoute.handler);
router.openapi(returnOrderProductRoute.route, returnOrderProductRoute.handler);
router.openapi(handOffOrderRoute.route, handOffOrderRoute.handler);

export default router;
