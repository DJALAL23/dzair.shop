/**
 * Orders API Response Schemas
 *
 * Clean, organized schemas for Orders API responses. Follows best practices:
 * - Input validation stays in endpoints/orders/validation.ts
 * - Response documentation lives here
 * - Use schema composition to avoid duplication
 * - Consistent naming: *Schema for entities, *ResponseSchema for API responses
 *
 * Related files:
 * - endpoints/orders/validation.ts: Request input schemas
 * - endpoints/orders/handlers.ts: CRUD handlers
 * - endpoints/orders/routes.ts: OpenAPI route definitions
 */

import { z } from "@hono/zod-openapi";
import { ShipmentSchema } from "./shipments";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { ORDER_STATUSES } from "../../../../cod-shared/orders/lifecycle";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";

// ─── Enums & Constants ────────────────────────────────────────────────────────

export const OrderStatusEnum = z.enum(ORDER_STATUSES);

export const DeliveryTypeEnum = z.enum(["home", "stop_desk"]);
export const OrderTypeEnum = z.enum(["online", "offline"]);
export const OrderProductStatusEnum = z.enum(["fulfilled", "partially_returned", "returned"]);

// ─── Nested/Child Schemas ─────────────────────────────────────────────────────

/**
 * Single status change entry in order history
 */
export const StatusHistoryItemSchema = z
  .object({
    id: z.string(),
    orderId: z.string(),
    status: OrderStatusEnum,
    timestamp: z.string().datetime().openapi({
      description: "When the status change happened",
    }),
    by: z.string().nullable().openapi({
      description: "User ID who triggered the status change",
    }),
    byName: z.string().nullable().openapi({
      description: "User display name",
    }),
  })
  .openapi("StatusHistoryItem");

/**
 * Single product line in an order
 */
export const OrderProductSchema = z
  .object({
    id: z.string(),
    orderId: z.string(),
    productId: z.string().nullable().openapi({ description: "Null once the product was removed: the line keeps what was sold" }),
    productName: z.string(),
    variantId: z.string().nullable().openapi({ description: "Null for a product without variants, or once the variant was removed" }),
    variantLabel: z.string().nullable(),
    sku: z.string().nullable().openapi({
      description: "Denormalized SKU at time of order",
    }),
    quantity: z.number().int().openapi({ example: 2 }),
    pricePerUnit: z.number().openapi({ example: 4500 }),
    lineTotal: z.number().openapi({ example: 9000 }),
    status: OrderProductStatusEnum.openapi({
      description:
        "Per-line fulfilment outcome — updated via PATCH /orders/{id}/products/{productLineId}/return",
    }),
    returnedQuantity: z.number().int().openapi({
      description:
        "Units the customer refused at the door. Always 0 when status=fulfilled, = quantity when status=returned.",
    }),
    createdAt: z.string().datetime(),
    offerId: z.string().nullable().openapi({
      description: "The offer that shaped the line: the quantity-pricing offer that set its price, or the gift offer that gave it. Null at the catalog price.",
    }),
    offerName: z.string().nullable().openapi({
      description: "The offer's name when the order was placed — kept when the offer is renamed or deleted. Null without an offer.",
      example: "اشترِ 2 والثالثة مجاناً",
    }),
    reward: z.boolean().openapi({ description: "A gift, given by `offerId` at no charge" }),
    discount: z.number().int().openapi({ description: "The line's share of the order's coupon discount; `lineTotal` is already net of it" }),
  })
  .openapi("OrderProduct");

// ─── Base Order Schema (shared fields) ────────────────────────────────────────

/**
 * Base order fields shared across list and detail views
 */
const OrderBaseSchema = z.object({
  id: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
  orderNumber: z.string().openapi({ example: "ORD-20260327-0042" }),
  customerId: z.string(),
  customerName: z.string().openapi({ example: "Ahmed Benali" }),
  phone: z.string().openapi({ example: "0551234567" }),
  
  // Location (with joins)
  wilayaId: z.number().int().min(1).max(58).nullable().openapi({ example: 16 }),
  wilaya: z.string().nullable().openapi({
    description: "Wilaya Arabic name, joined from reference table",
    example: "الجزائر",
  }),
  communeId: z.string().nullable(),
  commune: z.string().nullable().openapi({
    description: "Commune Arabic name, joined from reference table",
    example: "بئر مراد رايس",
  }),
  city: z.string().nullable(),
  address: z.string().nullable(),

  // Pricing
  price: z.number().openapi({
    description: "Product subtotal (excluding delivery fee)",
    example: 9000,
  }),
  deliveryFee: z.number().openapi({ example: 400 }),
  codAmount: z.number().nullable().openapi({
    description: "What the customer owes on delivery: price + deliveryFee",
    example: 9400,
  }),

  // Status
  status: OrderStatusEnum.openapi({ description: "The order's processing; its delivery is its shipment's (see `stage`)" }),
  orderType: OrderTypeEnum,
  deliveryType: DeliveryTypeEnum.openapi({ description: "What the customer asked for; the shipment may ship otherwise" }),
  stationCode: z.string().nullable(),
  driverName: z.string().nullable().openapi({
    description: "The name of the store's driver delivering it, when its shipment is a driver's",
  }),
  notes: z.string().nullable(),
  landingPageId: z.string().nullable().openapi({ description: "The landing page the order was placed on, if any" }),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Checkout form capture
  customerEmail: z.string().nullable().optional().openapi({
    description: "Email supplied at order time",
  }),
  customFieldsJson: z.string().nullable().optional().openapi({
    description: "Custom checkout fields snapshot JSON",
  }),
  archivedAt: z.string().datetime().nullable().openapi({
    description: "When the finished order was archived: it is left out of the working lists and their counts, and still counts in sales and the customer's history. Null while not archived.",
  }),
  deliveryOfferId: z.string().nullable().openapi({
    description: "The offer that made delivery free (a free-shipping offer, or a quantity tier that includes it); null when none did",
  }),
  deliveryOfferName: z.string().nullable().openapi({
    description: "That offer's name when the order was placed — kept when the offer is renamed or deleted",
  }),
  couponId: z.string().nullable().openapi({ description: "The coupon the order was placed with; null when none, or once the coupon is deleted" }),
  couponCode: z.string().nullable().openapi({ description: "The code the order used, kept when the coupon is deleted" }),
  couponDiscount: z.number().int().openapi({ description: "What the coupon took off; `price` is already net of it" }),
  locale: z.enum(STORE_LOCALES).nullable().openapi({
    description: "The language the order was placed in — the shopper's storefront language, the store's primary for a dashboard or agent order — and the one its customer messages are written in; null for an order placed before it was recorded",
    example: "fr",
  }),
});

export const OrderRemovalSchema = z
  .object({
    id: z.string(),
    orderNumber: z.string().openapi({ example: "ORD-20261016-0042" }),
    shipment: z.enum(["none", "open", "closed"]).openapi({ description: "No shipment yet, one on its way, or one that ended (delivered, returned, cancelled)" }),
    deletable: z.boolean().openapi({ description: "Only an order never handed to delivery" }),
    archivable: z.boolean().openapi({ description: "A finished order (cancelled, or its shipment ended) not archived yet" }),
    archivedAt: z.string().datetime().nullable(),
    lines: z.number().int().openapi({ description: "Its order lines, removed with it" }),
    restockUnits: z.number().int().openapi({ description: "Units deleting it puts back in stock" }),
    reviews: z.number().int().openapi({ description: "Its reviews, removed with it" }),
  })
  .openapi("OrderRemoval");

// ─── List View (for GET /orders) ──────────────────────────────────────────────

/**
 * Order list item - includes joins but not heavy nested arrays
 */
export const OrderListItemSchema = OrderBaseSchema.extend({
  hasReview: z.number().int().optional().openapi({
    description:
      "1 if a customer review exists for this order, 0 otherwise. Included in list responses only (GET /api/orders).",
  }),
  lastUpdatedBy: z.string().nullable().optional().openapi({
    description:
      "User ID of the last status-change actor. Included in list responses only (GET /api/orders).",
  }),
  shipmentId: z.string().nullable().optional().openapi({ description: "The order's shipment, or null before handoff. List responses only." }),
  shipmentKind: z.enum(["carrier", "driver"]).nullable().optional().openapi({ description: "Handed to a carrier, or to the store's driver; null before handoff. List responses only." }),
  carrierName: z.string().nullable().optional().openapi({ description: "The delivery company carrying it, for a carrier shipment. List responses only." }),
  trackingNumber: z.string().nullable().optional().openapi({ description: "The parcel's tracking number at the carrier. List responses only." }),
  stage: z.enum(ORDER_STAGES).optional().openapi({
    description: "Where the order stands overall — its processing, then its shipment's delivery. List responses only.",
  }),
  needsAttention: z.boolean().optional().openapi({ description: "Whether the order's delivery needs the merchant. List responses only." }),
}).openapi("OrderListItem", {
  description: "Order summary for list view - includes joins but not nested arrays",
});

// ─── Detail View (for GET /orders/{id}) ───────────────────────────────────────

/**
 * Full order detail - includes products and status history
 */
export const OrderDetailSchema = OrderBaseSchema.extend({
  products: z.array(OrderProductSchema).optional().openapi({
    description: "Order line items. Included in GET /api/orders/{id} (detail view only).",
  }),
  statusHistory: z.array(StatusHistoryItemSchema).optional().openapi({
    description: "Full status change log. Included in GET /api/orders/{id} (detail view only).",
  }),
  shipment: ShipmentSchema.nullable().optional().openapi({
    description: "The order's delivery, with its history and the actions available now; null before handoff. Detail view only.",
  }),
  stage: z.enum(ORDER_STAGES).optional().openapi({
    description: "Where the order stands overall — its processing, then its shipment's delivery.",
  }),
  needsAttention: z.boolean().optional().openapi({
    description: "The merchant must act on the delivery: the carrier flagged it, the handoff outcome is unknown, or the carrier cancelled it",
  }),
}).openapi("Order", {
  description: "Complete order record with products and status history",
});

// For backward compatibility - routes.ts currently uses "OrderSchema"
export const OrderSchema = OrderDetailSchema;

// ─── Create Order Response ────────────────────────────────────────────────────

/**
 * Response data returned after successfully creating an order
 */
export const OrderCreatedDataSchema = z
  .object({
    id: z.string().openapi({ description: "Newly created order ID" }),
    orderNumber: z.string().openapi({ example: "ORD-20260327-0042" }),
    deliveryFee: z.number().openapi({
      description: "Calculated delivery fee (from shipping profile or admin override)",
      example: 600,
    }),
    price: z.number().openapi({
      description: "Product subtotal (excluding delivery fee)",
      example: 2500,
    }),
    codAmount: z.number().openapi({
      description: "Total amount to collect (price + deliveryFee)",
      example: 3100,
    }),
    customerId: z.string(),
    customerName: z.string(),
    phone: z.string(),
    wilayaId: z.number().int(),
    communeId: z.string().nullable(),
    deliveryType: DeliveryTypeEnum,
    orderType: OrderTypeEnum,
    status: z.string().openapi({ description: "Initial order status", example: "new" }),
  })
  .openapi("OrderCreatedData");

// ─── Return Product Response ──────────────────────────────────────────────────

/**
 * Response after recording a product line return
 */
export const ReturnProductDataSchema = z
  .object({
    returnedQuantity: z.number().int(),
    status: OrderProductStatusEnum,
  })
  .openapi("ReturnProductData");

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export type DeliveryType = z.infer<typeof DeliveryTypeEnum>;
export type OrderType = z.infer<typeof OrderTypeEnum>;
export type OrderProductStatus = z.infer<typeof OrderProductStatusEnum>;


// ─── Abandoned Orders ─────────────────────────────────────────────────────────

export const AbandonedOrderStatusEnum = z.enum([
  "pending",
  "abandoned",
  "contacted",
  "converted",
]);

export const AbandonedOrderItemSchema = z
  .object({
    productId: z.string(),
    productName: z.string().openapi({ example: "Hoodie Classic" }),
    variantId: z.string().nullish(),
    variantLabel: z.string().nullish().openapi({ example: "Noir / L" }),
    quantity: z.number().int().openapi({ example: 2 }),
    unitPrice: z.number().openapi({
      description: "Price shown to the shopper at abandonment. Display only.",
      example: 2400,
    }),
  })
  .openapi("AbandonedOrderItem");

export const AbandonedOrderSchema = z
  .object({
    id: z.string().openapi({ example: "ab_abc123" }),
    sessionId: z.string().openapi({
      description: "Storefront session ID — unique per abandoned checkout",
    }),
    customerName: z.string().openapi({ example: "Ahmed Benali" }),
    phone: z.string().openapi({ example: "0551234567" }),
    wilayaId: z.number().int().min(1).max(58).nullable().openapi({ example: 16 }),
    communeId: z.string().nullable(),
    wilayaName: z.string().nullable().openapi({ example: "الجزائر" }),
    communeName: z.string().nullable(),
    productId: z.string().nullable(),
    productName: z.string().nullable().openapi({
      description:
        "The only product, or the FIRST line of the basket. Always populated, so this column reads the same for both shapes.",
      example: "Samsung Galaxy A54",
    }),
    variantId: z.string().nullable(),
    variantLabel: z.string().nullable().openapi({ example: "أحمر / XL" }),
    price: z.number().nullable().openapi({
      description: "Cart value at abandonment — the basket subtotal, or one unit's price",
      example: 9000,
    }),
    items: AbandonedOrderItemSchema.array().nullable().openapi({
      description:
        "The whole basket, when the shopper abandoned a cart checkout. Null for a single-product checkout, where the flat product fields above are the record.",
    }),
    itemCount: z.number().int().nullable().openapi({
      description: "Distinct lines in the basket. Null for a single-product checkout.",
      example: 3,
    }),
    deliveryType: z.enum(["home", "stop_desk"]).nullable(),
    fbc: z.string().nullable().openapi({
      description: "_fbc cookie captured at input — links recovery back to the ad click",
    }),
    fbp: z.string().nullable().openapi({ description: "_fbp browser identity cookie" }),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    status: AbandonedOrderStatusEnum,
    convertedOrderId: z.string().nullable().openapi({
      description: "Set when the customer completes an order after contact",
    }),
    convertedOrderNumber: z.string().nullable(),
    recoveryAttempts: z.number().int().openapi({ example: 0 }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("AbandonedOrder");

export const AbandonedOrderStatsSchema = z
  .object({
    totalAbandoned: z.number().int().openapi({
      description: "Orders currently in `abandoned` status",
      example: 34,
    }),
    totalConverted: z.number().int().openapi({
      description: "Checkouts recovered: the shopper placed the order",
      example: 12,
    }),
  })
  .openapi("AbandonedOrderStats");

export type AbandonedOrderStatus = z.infer<typeof AbandonedOrderStatusEnum>;
