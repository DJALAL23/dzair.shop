import { drawOrderNumber } from "../../../../cod-shared/lib/order-number";
import { tool } from "ai";
import { z } from "zod";
import * as queries from "./queries";
import { lineReturnRefusal, orderHasShipment, refusalFor } from "./refusals";
import { transitionVerdict } from "./transitions";
import { getOrderShipment } from "../../../../cod-shared/shipments/queries";
import { loadOrderDetail } from "./detail";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  returnOrderProductSchema,
  orderFiltersSchema,
  ORDER_STATUSES,
} from "./validation";
import { getDb } from "@/db";
import { toolOutput, timestampSchema } from "@/lib/tool-output-schema";

/**
 * Layer-2 validation schemas, hoisted to module level and exported so the MCP
 * layer (src/mcp/schemas.ts) can derive tools/list inputSchema from the exact
 * same definitions — the advertised schema and the executed validation cannot
 * drift apart.
 */
export const listOrdersSchema = orderFiltersSchema;
export const getOrderDetailsSchema = z.object({
  orderId: z.string().uuid().describe("UUID of the order"),
});
export const createOrderToolSchema = createOrderSchema;
export const updateOrderStatusToolSchema = z.object({
  orderId: z.string().uuid().describe("UUID of the order"),
  status: updateOrderStatusSchema.shape.status,
});
export const recordOrderProductReturnToolSchema = z.object({
  orderId: z.string().uuid().describe("UUID of the order"),
  productLineId: z.string().uuid().describe("UUID of the order product line (the id field in order.products array)"),
  returnedQuantity: returnOrderProductSchema.shape.returnedQuantity,
});
export const deleteOrderSchema = z.object({
  orderId: z.string().uuid().describe("UUID of the order to delete"),
});

export const ORDER_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  listOrders: listOrdersSchema.shape,
  getOrderDetails: getOrderDetailsSchema.shape,
  createOrder: createOrderToolSchema.shape,
  updateOrderStatus: updateOrderStatusToolSchema.shape,
  recordOrderProductReturn: recordOrderProductReturnToolSchema.shape,
  deleteOrder: deleteOrderSchema.shape,
};

const orderRowSchema = z.looseObject({
  id: z.string().describe("Order UUID"),
  orderNumber: z.string().describe("Human-readable number (ORD-YYYYMMDD-NNNN) — what the customer sees"),
  status: z.string().optional().describe("Processing status; cancelled is terminal"),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  price: z.number().optional().describe("Product subtotal excluding delivery fee (DZD)"),
  deliveryFee: z.number().optional().describe("Delivery charge to the customer (DZD)"),
  codAmount: z.number().optional().describe("Cash the courier collects = price + deliveryFee (DZD)"),
  deliveryType: z.string().optional().describe("home | stop_desk"),
  stage: z.string().nullable().optional().describe("Where the order stands overall, its delivery included"),
  shipment: z.looseObject({}).nullable().optional().describe("The order's delivery (carrier or driver), with its history; null before handoff"),
});

export const ORDER_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  listOrders: toolOutput({
    count: z.number().int(),
    orders: z.array(
      z.looseObject({
        id: z.string().describe("Order UUID"),
        orderNumber: z.string(),
        status: z.string().describe("Processing status"),
        customerName: z.string(),
        phone: z.string(),
        wilaya: z.string(),
        commune: z.string(),
        price: z.number().describe("Product subtotal excluding delivery fee (DZD)"),
        deliveryFee: z.number().describe("Delivery charge (DZD)"),
        codAmount: z.number().describe("Cash the courier collects at the door (DZD)"),
        deliveryType: z.string().describe("home | stop_desk"),
        orderType: z.string().describe("online | offline"),
        driverName: z.string().nullable().describe("Assigned driver's name, or null"),
        stage: z.string().nullable().describe("Where the order stands overall: processing, then delivery (in_transit, delivered, returned…)"),
        needsAttention: z.boolean().describe("Whether the order's delivery needs the merchant"),
        shipmentId: z.string().nullable().describe("The order's shipment, or null before handoff"),
        hasReview: z.boolean().describe("Whether the anchor review exists"),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      }),
    ).describe("Orders, newest first"),
  }),
  getOrderDetails: toolOutput({
    order: orderRowSchema.describe("Full order: product lines, status history, place names, and delivery references"),
  }),
  createOrder: toolOutput({
    order: z.looseObject({
      id: z.string().describe("Order UUID"),
      orderNumber: z.string(),
      status: z.literal("new").describe("Newly created — not yet confirmed"),
      deliveryFee: z.number().describe("Delivery charge (DZD)"),
      price: z.number().describe("Product subtotal (DZD)"),
      codAmount: z.number().describe("Cash the courier collects = price + deliveryFee (DZD)"),
      customerId: z.string(),
      customerName: z.string(),
      phone: z.string(),
      wilayaId: z.number().int().describe("Wilaya number 1–58"),
      communeId: z.string().nullable().describe("Commune ID (c-XX-YYY), or null"),
      deliveryType: z.enum(["home", "stop_desk"]),
      orderType: z.enum(["online", "offline"]),
    }).describe("The created order — inventory was deducted"),
    message: z.string(),
  }),
  updateOrderStatus: toolOutput({
    message: z.string(),
    previousStatus: z.string(),
    newStatus: z.string().describe("cancelled restores inventory and is terminal"),
  }),
  recordOrderProductReturn: toolOutput({
    result: z.looseObject({
      status: z.enum(["fulfilled", "partially_returned", "returned"]).optional().describe("The order's return state after this line return"),
    }).describe("Return outcome"),
    message: z.string(),
  }),
  deleteOrder: toolOutput({
    message: z.string().describe("Deletion restores all remaining inventory"),
  }),
};

/**
 * AI Tools for Order Management
 *
 * Orders are the core entity of the CRM. Each order tracks a COD (cash-on-delivery)
 * sale from creation through delivery or return.
 *
 * ─── Status lifecycle (cod-shared/orders/lifecycle.ts) ──────────────────────
 *   new → confirmed | unreachable | cancelled
 *   confirmed → preparing | ready | unreachable | cancelled
 *   unreachable → confirmed | cancelled
 *   preparing → ready | cancelled
 *   ready → cancelled
 *   cancelled: terminal
 * An order with a shipment has no status change: its delivery is the
 * shipment's (in transit, delivered, returned…), and it stays "ready".
 *
 * ─── Delivery ────────────────────────────────────────────────────────────────
 *   A ready order is handed to a carrier or to the store's driver (the
 *   shipment tools); once it has a shipment, its delivery changes only
 *   through that shipment, and a returned shipment restocks the order.
 *
 * ─── Stock impact ────────────────────────────────────────────────────────────
 *   createOrder       → deducts inventory (ORDER_DEDUCTED)
 *   updateOrderStatus → restores inventory on cancelled (ORDER_CANCELLED)
 *   recordOrderProductReturn → restores per-line returned units (ORDER_RETURNED)
 *   deleteOrder       → restores all remaining inventory (ORDER_CANCELLED)
 *
 * ─── COD amount ──────────────────────────────────────────────────────────────
 *   codAmount = price + deliveryFee  (what the driver collects at the door)
 *
 * Two-Layer Validation Pattern:
 * - Layer 1 (LLM-level): Permissive input schema accepts any object to prevent SDK crashes
 * - Layer 2 (App-level): Strict validation inside execute() with graceful error handling
 */
export const getOrderTools = (db: ReturnType<typeof getDb>) => ({

  listOrders: tool({
    description:
      "Search and filter orders. Returns orders ordered newest-first. " +
      "Each order includes status, stage, needsAttention, shipmentId, customerName, phone, wilaya, price, deliveryFee, codAmount, " +
      "driverName, orderNumber, and hasReview flag. " +
      "Optional filters: status (new|confirmed|unreachable|preparing|ready|cancelled), " +
      "stage (new|confirmed|unreachable|preparing|ready_to_ship|handoff_pending|in_transit|out_for_delivery|delivered|returning|returned|delivery_cancelled|cancelled), " +
      "attention ('true'|'false'), " +
      "wilayaId (integer 1-58), search (matches orderNumber, customerName, or phone), " +
      "limit (1-100, default 50), offset (default 0).",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      // Layer 2: Strict validation
      const parsed = listOrdersSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error: `Invalid filter arguments: ${errorDetails}. Expected: status (${ORDER_STATUSES.join("|")}, optional), wilayaId (int 1-58, optional), search (string, optional), limit (1-100, default 50), offset (int >= 0, default 0)`,
        };
      }
      try {
        const orders = await queries.getAllOrders(db, parsed.data);
        return {
          success: true,
          count: orders.length,
          orders: orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            customerName: o.customerName,
            phone: o.phone,
            wilaya: o.wilaya,
            commune: o.commune,
            price: o.price,
            deliveryFee: o.deliveryFee,
            codAmount: o.codAmount,
            deliveryType: o.deliveryType,
            orderType: o.orderType,
            driverName: o.driverName,
            stage: o.stage,
            needsAttention: o.needsAttention,
            shipmentId: o.shipmentId,
            hasReview: o.hasReview,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
          })),
        };
      } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
      }
    },
  }),

  getOrderDetails: tool({
    description:
      "Fetch full details for a specific order by UUID. " +
      "Returns the complete order including products array (with quantities, prices, returnedQuantity, status), " +
      "statusHistory (chronological list of status changes with timestamps and actor names), " +
      "wilaya/commune Arabic names, stage, needsAttention, and shipment: the order's delivery (carrier or driver, " +
      "its tracking, its history and the actions open now), or null before handoff. " +
      "Use this before updating status, handing the order off, reporting on its delivery, or recording a return.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      const validationSchema = getOrderDetailsSchema;
      const parsed = validationSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: orderId (UUID string)`,
        };
      }
      try {
        const order = await loadOrderDetail(db, parsed.data.orderId);
        if (!order) {
          return { success: false, error: `Order not found with ID: ${parsed.data.orderId}` };
        }
        return { success: true, order };
      } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
      }
    },
  }),

  createOrder: tool({
    description:
      "Creates a new COD order. " +
      "Required: customerId (UUID), customerName (string), phone (Algerian 0[5-7]XXXXXXXX), " +
      "wilayaId (int 1-58), price (positive number, product total in DZD), " +
      "products (array, min 1 item — each needs productId, productName, quantity, pricePerUnit, lineTotal). " +
      "Optional: communeId (UUID), city, address, notes, " +
      "orderType ('online'|'offline', default 'online'), " +
      "deliveryType ('home'|'stop_desk', default 'home'), " +
      "deliveryFee (number >= 0 — for offline orders only; online orders auto-resolve from shipping profile). " +
      "variantId and variantLabel are optional per product line. " +
      "codAmount = price + deliveryFee (auto-computed). " +
      "Stock is deducted automatically on creation for tracked products.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      const parsed = createOrderSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error:
            `Invalid order data: ${errorDetails}. ` +
            `Required: customerId (UUID), customerName (string), phone (0[5-7]XXXXXXXX), ` +
            `wilayaId (int 1-58), price (positive number DZD), ` +
            `products (array min 1: [{productId, productName, quantity (int > 0), pricePerUnit (positive), lineTotal (positive), variantId?, variantLabel?}]). ` +
            `Optional: communeId (UUID), city, address, notes, ` +
            `orderType (online|offline, default online), deliveryType (home|stop_desk, default home), ` +
            `deliveryFee (number >= 0, offline only).`,
        };
      }

      try {
        // ORD-YYYYMMDD-NNNN; createOrder draws again if this one is taken.
        const date = new Date();
        const drawnNumber = drawOrderNumber(date);
        const now = date.toISOString();
        const orderId = crypto.randomUUID();

        // Resolve delivery fee from shipping profile
        const { resolveDeliveryFee, applyFreeShippingOffer } = await import("./resolve-fee");
        let deliveryFee = parsed.data.deliveryFee ?? 0;
        if (parsed.data.wilayaId) {
          try {
            const productIds = parsed.data.products.map((p) => p.productId);
            const resolved = await resolveDeliveryFee(db, {
              wilayaId: parsed.data.wilayaId,
              communeId: parsed.data.communeId ?? null,
              deliveryType: parsed.data.deliveryType,
              productIds,
            });
            if (parsed.data.orderType === "online" || parsed.data.deliveryFee == null) {
              deliveryFee = resolved.deliveryFee;
            }
            const productQuantities = new Map(parsed.data.products.map((p) => [p.productId, p.quantity]));
            deliveryFee = await applyFreeShippingOffer(db, deliveryFee, productIds, productQuantities);
          } catch (err) {
            if (parsed.data.orderType === "online") throw err;
            deliveryFee = parsed.data.deliveryFee ?? 0;
          }
        }

        // Auto-create customer if not in DB
        const { wilayas, communes, customers } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const existingCustomer = await db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, parsed.data.customerId))
          .get();

        if (!existingCustomer) {
          const [wilayaRow, communeRow] = await Promise.all([
            db.select({ nameAr: wilayas.nameAr }).from(wilayas).where(eq(wilayas.id, parsed.data.wilayaId)).get(),
            parsed.data.communeId
              ? db.select({ nameAr: communes.nameAr }).from(communes).where(eq(communes.id, parsed.data.communeId)).get()
              : Promise.resolve(null),
          ]);
          await db.insert(customers).values({
            id: parsed.data.customerId,
            name: parsed.data.customerName,
            phone: parsed.data.phone,
            phone2: null,
            wilayaId: parsed.data.wilayaId,
            communeId: parsed.data.communeId ?? null,
            wilaya: wilayaRow?.nameAr ?? String(parsed.data.wilayaId),
            commune: communeRow?.nameAr ?? null,
            address: parsed.data.address ?? null,
            totalOrders: 0,
            totalSpent: 0,
            createdAt: now,
            lastOrderAt: null,
          });
        }

        const orderData = {
          id: orderId,
          orderNumber: drawnNumber,
          customerId: parsed.data.customerId,
          customerName: parsed.data.customerName,
          phone: parsed.data.phone,
          wilayaId: parsed.data.wilayaId,
          communeId: parsed.data.communeId ?? null,
          city: parsed.data.city || null,
          address: parsed.data.address || null,
          price: parsed.data.price,
          notes: parsed.data.notes || null,
          status: "new" as const,
          orderType: parsed.data.orderType,
          deliveryType: parsed.data.deliveryType,
          deliveryFee,
          codAmount: parsed.data.price + deliveryFee,
          createdAt: now,
          updatedAt: now,
        };

        const productsData = parsed.data.products.map((p) => ({
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

        const { orderNumber } = await queries.createOrder(db, orderData, productsData, null);

        return {
          success: true,
          order: {
            id: orderId,
            orderNumber,
            status: "new",
            deliveryFee,
            price: parsed.data.price,
            codAmount: parsed.data.price + deliveryFee,
            customerId: parsed.data.customerId,
            customerName: parsed.data.customerName,
            phone: parsed.data.phone,
            wilayaId: parsed.data.wilayaId,
            communeId: parsed.data.communeId ?? null,
            deliveryType: parsed.data.deliveryType,
            orderType: parsed.data.orderType,
          },
          message: `Order ${orderNumber} created successfully`,
        };
      } catch (error: any) {
        return { success: false, error: `Failed to create order: ${error.message}` };
      }
    },
  }),

  updateOrderStatus: tool({
    description:
      "Updates an order's processing status. Required: orderId (UUID), status. " +
      "Statuses: new, confirmed, unreachable, preparing, ready, cancelled. " +
      "Transitions: new → confirmed|unreachable|cancelled; confirmed → preparing|ready|unreachable|cancelled; " +
      "unreachable → confirmed|cancelled; preparing → ready|cancelled; ready → cancelled; cancelled is terminal. " +
      "Refused once the order has a shipment — delivery is the shipment's. " +
      "Cancelling restores inventory for tracked products and rolls back the customer's spend.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      const validationSchema = updateOrderStatusToolSchema;
      const parsed = validationSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: orderId (UUID), status (${ORDER_STATUSES.join("|")})`,
        };
      }

      try {
        const order = await queries.getOrderById(db, parsed.data.orderId);
        if (!order) {
          return { success: false, error: `Order not found with ID: ${parsed.data.orderId}` };
        }

        const verdict = transitionVerdict(order.status, Boolean(await getOrderShipment(db, parsed.data.orderId)), parsed.data.status);
        if (!verdict.ok) {
          if (verdict.code === ERROR_CODES.ORDER_HAS_SHIPMENT) {
            return { success: false, error: orderHasShipment(parsed.data.orderId, "its status no longer changes").message };
          }
          return {
            success: false,
            error: `Cannot transition order "${order.orderNumber}" from "${order.status}" to "${parsed.data.status}". Allowed next statuses: [${verdict.allowed.join(", ") || "none"}]`,
          };
        }

        const change = await queries.updateOrderStatus(db, parsed.data.orderId, parsed.data.status, "ai-agent", "AI Agent");
        if (!change.ok) {
          return { success: false, error: refusalFor(change, parsed.data.orderId, "its status no longer changes").message };
        }

        return {
          success: true,
          message: `Order "${order.orderNumber}" status updated from "${order.status}" to "${parsed.data.status}"`,
          previousStatus: order.status,
          newStatus: parsed.data.status,
        };
      } catch (error: any) {
        return { success: false, error: `Failed to update order status: ${error.message}` };
      }
    },
  }),

  recordOrderProductReturn: tool({
    description:
      "Records how many units on a single order line the customer refused at the door. " +
      "Used for the Algerian 'open the box at delivery' workflow. " +
      "Required: orderId (UUID), productLineId (UUID of the order product line), returnedQuantity (int 0 to line.quantity). " +
      "returnedQuantity=0 → line status 'fulfilled'. " +
      "returnedQuantity=line.quantity → line status 'returned'. " +
      "0 < returnedQuantity < line.quantity → line status 'partially_returned'. " +
      "Returned units are automatically restocked. Calls are idempotent — correcting a previous return adjusts the delta. " +
      "Blocked once the order is cancelled or its parcel came back. " +
      "Use getOrderDetails first to find the productLineId (it's the id field in the products array).",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      const validationSchema = recordOrderProductReturnToolSchema;
      const parsed = validationSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: orderId (UUID), productLineId (UUID), returnedQuantity (int >= 0, max = line quantity)`,
        };
      }

      try {
        const order = await queries.getOrderById(db, parsed.data.orderId);
        if (!order) {
          return { success: false, error: `Order not found with ID: ${parsed.data.orderId}` };
        }

        const result = await queries.setOrderProductReturn(
          db,
          parsed.data.orderId,
          parsed.data.productLineId,
          parsed.data.returnedQuantity,
          "ai-agent",
          "AI Agent",
        );
        if (!result.ok) {
          return { success: false, error: lineReturnRefusal(result, parsed.data.orderId, parsed.data.productLineId).message };
        }
        const { ok: _, ...line } = result;

        return {
          success: true,
          result: line,
          message: `Return recorded: ${parsed.data.returnedQuantity} unit(s) returned on line ${parsed.data.productLineId}. Line status: ${result.status}`,
        };
      } catch (error: any) {
        return { success: false, error: `Failed to record return: ${error.message}` };
      }
    },
  }),

  deleteOrder: tool({
    description:
      "Permanently deletes an order and its related records (products, status history, its shipment and that shipment's history). " +
      "Refused while its parcel is out, and once a driver payment settled its delivery. " +
      "Automatically restores inventory for all non-returned product lines and updates customer stats. " +
      "WARNING: This is a hard delete — there is no soft-delete or recovery. " +
      "Consider updating status to 'cancelled' instead if you want to keep the order for audit purposes.",
    inputSchema: z.object({}).passthrough(), // Layer 1: Permissive input
    execute: async (args) => {
      const validationSchema = deleteOrderSchema;
      const parsed = validationSchema.safeParse(args);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          error: `Invalid arguments: ${errorDetails}. Expected: orderId (UUID string)`,
        };
      }

      try {
        const order = await queries.getOrderById(db, parsed.data.orderId);
        if (!order) {
          return { success: false, error: `Order not found with ID: ${parsed.data.orderId}` };
        }

        const deletion = await queries.deleteOrder(db, parsed.data.orderId);
        if (!deletion.ok) {
          return { success: false, error: refusalFor(deletion, parsed.data.orderId, "it cannot be deleted while its parcel is out").message };
        }

        return {
          success: true,
          message: `Order "${order.orderNumber}" (${parsed.data.orderId}) permanently deleted. Inventory restored for non-returned lines.`,
        };
      } catch (error: any) {
        return { success: false, error: `Failed to delete order: ${error.message}` };
      }
    },
  }),
});
