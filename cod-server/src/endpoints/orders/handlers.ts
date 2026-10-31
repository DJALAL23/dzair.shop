/**
 * Orders Route Handlers - CRUD Operations
 * 
 * Basic HTTP handlers for orders listing, retrieval, creation, and deletion.
 * Complex operations (dispatch, status transitions) are in separate modules.
 */

import { assertOrderAddress } from "@/lib/order-address";
import { drawOrderNumber } from "../../../../cod-shared/lib/order-number";
import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import * as validation from "./validation";
import { lineReturnRefusal, refusalFor } from "./refusals";
import { loadOrderDetail } from "./detail";
import { orderDelivery } from "./delivery";
import { quoteOrderDelivery } from "../../../../cod-shared/queries/delivery-quote";
import { orderCustomerId } from "../../../../cod-shared/queries/customers";
import { logActivity, ACTIONS } from "@/lib/activity";
import { NotFoundError, ValidationError, BusinessLogicError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

/**
 * GET /orders
 * List all orders with optional filters
 */
export async function listOrders(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);

    const queryData: any = (c.req as any).valid?.("query");
    const filters = queryData ?? validation.orderFiltersSchema.parse(c.req.query());

    const orders = await queries.getAllOrders(db, filters);
    const last = orders.at(-1);

    return c.json({
      success: true,
      data: orders,
      count: orders.length,
      nextCursor: last && orders.length === filters.limit ? queries.encodeOrderCursor(last.createdAt, last.id) : null,
    }, 200);
  } catch (error) {
    throw error;
  }
}

/**
 * GET /orders/:id
 * Get single order by ID
 */
export async function getOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await loadOrderDetail(db, orderId);
  if (!order) throw new NotFoundError("Order", orderId);
  return c.json({ success: true, data: order }, 200);
}

/**
 * POST /orders
 * Create new order
 */
export async function createOrder(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);
    const bodyData: any = (c.req as any).valid?.("json");
    const validated: validation.CreateOrderInput =
      bodyData ?? validation.createOrderSchema.parse(await c.req.json());

    await assertOrderAddress(db, { wilayaId: validated.wilayaId, communeId: validated.communeId ?? null });

    // ORD-YYYYMMDD-NNNN; createOrder draws again if this one is taken.
    const date = new Date();
    const drawnNumber = drawOrderNumber(date);

    const now = date.toISOString();
    const orderId = crypto.randomUUID();

    const delivery = await orderDelivery(db, validated);
    const deliveryFee = delivery.deliveryFee;

    const customerId = await orderCustomerId(db, {
      customerId: validated.customerId,
      name: validated.customerName,
      phone: validated.phone,
      email: validated.customerEmail,
      wilayaId: validated.wilayaId,
      communeId: validated.communeId,
      address: validated.address,
      now,
    });

    // Prepare order data
    const orderData = {
      id: orderId,
      orderNumber: drawnNumber,
      customerId,
      customerName: validated.customerName,
      phone: validated.phone,
      wilayaId: validated.wilayaId,
      communeId: validated.communeId ?? null,
      city: validated.city || null,
      address: validated.address || null,
      customerEmail: validated.customerEmail ?? null,
      price: validated.price,
      notes: validated.notes || null,
      status: "new" as const,
      orderType: validated.orderType,
      deliveryType: validated.deliveryType,
      deliveryFee,
      deliveryOfferId: delivery.deliveryOfferId,
      deliveryOfferName: delivery.deliveryOfferName,
      codAmount: validated.price + deliveryFee,
      createdAt: now,
      updatedAt: now,
    };

    // Prepare order products
    const productsData = validated.products.map((p) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: p.productId,
      productName: p.productName,
      variantId: p.variantId || null,
      variantLabel: p.variantLabel || null,
      quantity: p.quantity,
      pricePerUnit: p.pricePerUnit,
      lineTotal: p.lineTotal,
      createdAt: now,
    }));

    const actor = c.get("user");
    const { orderNumber } = await queries.createOrder(db, orderData, productsData, c.get("author"));
    await logActivity(db, actor, ACTIONS.ORDER_CREATED, {
      type: "order", id: orderId, label: orderNumber,
    });

    return c.json(
      {
        success: true,
        data: {
          id: orderId,
          orderNumber,
          deliveryFee,
          price: validated.price,
          codAmount: validated.price + deliveryFee,
          customerId,
          customerName: validated.customerName,
          phone: validated.phone,
          wilayaId: validated.wilayaId,
          communeId: validated.communeId ?? null,
          deliveryType: validated.deliveryType,
          orderType: validated.orderType,
          status: "new",
        },
        message: "Order created successfully",
      },
      201
    );
  } catch (error) {
    throw error;
  }
}

/**
 * PATCH /orders/:id
 * Edit customer/destination fields on an order — how a merchant records an
 * address collected over the phone when the checkout hid the field.
 *
 * Once the order has a shipment, its delivery details are refused (the label
 * already carries them — they change through PATCH /shipments/:id); a
 * cancelled order is refused too, its books are already reconciled.
 */
export async function updateOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  if (order.status === "cancelled") {
    throw new BusinessLogicError(
      `Cannot edit a ${order.status} order — it was already reconciled.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status }
    );
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.UpdateOrderInput =
    bodyData ?? validation.updateOrderSchema.parse(await c.req.json());

  // Reference-table checks: dispatch re-validates, but an edit should fail
  // with an actionable 400 instead of a per-parcel carrier rejection later.
  await assertOrderAddress(db, { wilayaId: validated.wilayaId, communeId: validated.communeId }, { orderId });

  // Reject a home delivery whose address the edit itself empties. Edits that
  // touch neither field pass through — a phone-collected order may legitimately
  // have no address yet, and the dispatch guard still fails closed.
  if (validated.address !== undefined || validated.deliveryType !== undefined) {
    const resultAddress = validated.address !== undefined ? validated.address : order.address;
    const resultDeliveryType = validated.deliveryType ?? order.deliveryType;
    if (resultDeliveryType === "home" && !(resultAddress ?? "").trim()) {
      throw new ValidationError(
        "Address is required for home delivery",
        ERROR_CODES.MISSING_ADDRESS,
        { orderId }
      );
    }
  }

  const edit = await queries.updateOrder(db, orderId, {
    customerName: validated.customerName,
    phone: validated.phone,
    customerEmail: validated.customerEmail,
    wilayaId: validated.wilayaId,
    communeId: validated.communeId,
    city: validated.city,
    address: validated.address,
    deliveryType: validated.deliveryType,
    notes: validated.notes,
  }, c.get("author"));
  if (!edit.ok) throw refusalFor(edit, orderId, "its address, phone, wilaya, commune and delivery type are the parcel's");

  const actor = c.get("user");
  await logActivity(db, actor, ACTIONS.ORDER_UPDATED, {
    type: "order", id: orderId, label: order.orderNumber,
  }, { fields: Object.keys(validated) });

  const updated = await queries.getOrderById(db, orderId);

  return c.json({
    success: true,
    data: updated,
    message: "Order updated successfully",
  }, 200);
}

/**
 * PATCH /orders/:id/products/:productLineId/return
 *
 * Record how many units on a single order line the customer refused at the
 * door. Used for the Algerian "open the box at delivery" workflow where a
 * customer may accept part of an order and return the rest.
 *
 * Body: { returnedQuantity: number }  // 0 ≤ n ≤ line.quantity
 *
 * Server:
 *  - computes status ("fulfilled" | "partially_returned" | "returned")
 *    from newReturnedQuantity / line.quantity
 *  - restocks the delta vs. the line's current returnedQuantity so repeated
 *    calls are idempotent and correcting an overstated return un-restocks
 *  - logs a stock_movement with type ORDER_RETURNED
 *
 * Refused once the order is cancelled or its parcel came back — those put
 * every remaining unit back already (checked inside the write).
 */
export async function returnOrderProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");
  const productLineId = c.req.param("productLineId");

  if (!orderId || !productLineId) {
    throw new ValidationError("Order ID and product line ID are required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.ReturnOrderProductInput =
    bodyData ?? validation.returnOrderProductSchema.parse(await c.req.json());

  const user = c.get("user");

  const outcome = await queries.setOrderProductReturn(db, orderId, productLineId, validated.returnedQuantity, c.get("author"));
  if (!outcome.ok) throw lineReturnRefusal(outcome, orderId, productLineId);
  const { ok: _, ...result } = outcome;

  await logActivity(db, user, ACTIONS.ORDER_PRODUCT_RETURNED, {
    type: "order", id: orderId, label: order.orderNumber,
  }, { productLineId, returnedQuantity: result.returnedQuantity, status: result.status });

  return c.json({ success: true, data: result, message: "Return recorded" }, 200);
}

/**
 * DELETE /orders/:id
 * Delete an order never handed to delivery: its stock goes back, the
 * customer's count and spend are undone, and its lines, history, reviews and
 * logs go with it. Refused once it has a shipment — a finished order is
 * archived instead.
 */
export async function deleteOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const order = await queries.getOrderById(db, orderId);
  if (!order) throw new NotFoundError("Order", orderId);

  const deletion = await queries.deleteOrder(db, orderId, c.get("author"));
  if (!deletion.ok) throw refusalFor(deletion, orderId, "it cannot be deleted; archive it once its delivery has ended");

  await logActivity(db, c.get("user"), ACTIONS.ORDER_DELETED, { type: "order", id: orderId, label: order.orderNumber });
  return c.json({ success: true, message: "Order deleted" }, 200);
}

/**
 * GET /orders/:id/removal
 * What can be done to clear the order away — delete or archive — and what
 * deleting it would undo, so the dashboard can say it before asking.
 */
export async function getOrderRemoval(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const removal = await queries.orderRemoval(db, orderId);
  if (!removal) throw new NotFoundError("Order", orderId);
  return c.json({ success: true, data: removal }, 200);
}

/** POST /orders/:id/archive — a finished order leaves the working lists. */
export async function archiveOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const outcome = await queries.archiveOrder(db, orderId);
  if (!outcome.ok) throw refusalFor(outcome, orderId, "it cannot be archived");
  await logActivity(db, c.get("user"), ACTIONS.ORDER_ARCHIVED, { type: "order", id: orderId });
  return c.json({ success: true, data: { archivedAt: outcome.archivedAt } }, 200);
}

/** POST /orders/:id/unarchive — back to the working lists. */
export async function unarchiveOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;
  const outcome = await queries.unarchiveOrder(db, orderId);
  if (!outcome.ok) throw refusalFor(outcome, orderId, "it cannot be restored");
  await logActivity(db, c.get("user"), ACTIONS.ORDER_UNARCHIVED, { type: "order", id: orderId });
  return c.json({ success: true, data: { archivedAt: null } }, 200);
}

/**
 * POST /orders/delivery-quote — what delivery would cost on an order the
 * merchant is entering, and why it is free when it is: the fee the order
 * will charge if the merchant leaves it as it is.
 */
export async function quoteDelivery(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const body = (c.req as any).valid("json") as validation.DeliveryQuoteInput;
  const quote = await quoteOrderDelivery(db, { ...body, communeId: body.communeId ?? null, now: new Date().toISOString() });
  return c.json({ success: true, data: quote }, 200);
}
