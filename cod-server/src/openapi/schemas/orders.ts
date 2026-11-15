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

import { ASSIGNMENT_WAYS } from "../../../../cod-shared/team/model";
import { z } from "@hono/zod-openapi";
import { ShipmentSchema } from "./shipments";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { ORDER_STATUSES } from "../../../../cod-shared/orders/lifecycle";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import { ATTRIBUTION_METHODS, ATTRIBUTION_PLATFORMS, CLICK_ID_TYPES, ORDER_CHANNELS } from "../../../../cod-shared/attribution/model";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";

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
        "Units back in stock: those the customer refused at the door on a delivered order, or every unit once the order is cancelled or its parcel comes back (for a product that tracks stock). Always 0 when status=fulfilled, = quantity when status=returned.",
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
    unitCost: z.number().int().nullable().optional().openapi({ description: "What one unit cost the merchant, frozen when the order was written (the variant's cost, else the product's); null when not known. Only for a member with finance:read" }),
    unitCostSource: z.enum(["catalog", "manual"]).nullable().optional().openapi({ description: "Where `unitCost` came from: the catalog when the order was written, or set by hand. Only with finance:read" }),
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
  wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID).nullable().openapi({ example: 16 }),
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
  assigneeId: z.string().nullable().openapi({ description: "The confirmation team member the order is with now; null while it is with nobody" }),
  assigneeName: z.string().nullable().optional().openapi({ description: "That member's name" }),
  assignedAt: z.string().nullable().openapi({ description: "When it was given to them" }),
  takeBacks: z.number().int().openapi({ description: "How many times it was taken back from a member who did not act on it in time. At the store's limit it waits for a manager" }),
  callbackAt: z.string().nullable().openapi({ description: "When the customer asked to be called back; cleared once the order is confirmed or cancelled" }),
  decidedAt: z.string().nullable().openapi({ description: "Its first move away from new (confirmed, not reached or cancelled); null while new, or for an order older than the store's 90-day event log when the team arrived" }),
  decidedBy: z.string().nullable().openapi({ description: "The member who made that first move; null when the system did" }),
  confirmedAt: z.string().nullable().openapi({ description: "When it was first confirmed" }),
  confirmedBy: z.string().nullable().openapi({ description: "The member credited with confirming it" }),
  unansweredCalls: z.number().int().openapi({ description: "Calls without an answer: one more for each move to `unreachable`, so an order on no answer is at Call 1, Call 2, Call 3… Kept once it is confirmed or cancelled", example: 2 }),
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
/** Where an order came from, in short: what an order list and an Order Protection attempt show. */
export const OrderSourceSchema = z
  .object({
    channel: z.enum(ORDER_CHANNELS),
    platform: z.enum(ATTRIBUTION_PLATFORMS),
    app: z.string().nullable().openapi({ description: "The Meta app: `fb`, `ig`, `msg`, `an`, `th`, `wa`" }),
    adName: z.string().nullable().openapi({ description: "The credited ad's name, when the ad URL carried one" }),
    campaignName: z.string().nullable().openapi({ description: "The credited campaign's name, when the ad URL carried one" }),
  })
  .openapi("OrderSource");

export const OrderListItemSchema = OrderBaseSchema.extend({
  hasReview: z.number().int().optional().openapi({
    description:
      "1 if a customer review exists for this order, 0 otherwise. Included in list responses only (GET /api/orders).",
  }),
  flagged: z.number().int().optional().openapi({
    description: "1 if Order Protection flagged this order, 0 otherwise. List responses only (GET /api/orders).",
  }),
  flagReasons: z
    .array(
      z.object({
        ruleId: z.string(),
        name: z.string(),
        mode: z.enum(["trial", "active"]),
        action: z.enum(["spam", "flag", "accept"]),
        template: z.string().optional().openapi({ description: "The template rule it came from, unrenamed; clients name it in the reader's language" }),
      }),
    )
    .optional()
    .openapi({ description: "The Active Flag rules that flagged this order; empty when it was not flagged. List responses only." }),
  shipmentId: z.string().nullable().optional().openapi({ description: "The order's shipment, or null before handoff. List responses only." }),
  shipmentKind: z.enum(["carrier", "driver"]).nullable().optional().openapi({ description: "Handed to a carrier, or to the store's driver; null before handoff. List responses only." }),
  carrierName: z.string().nullable().optional().openapi({ description: "The delivery company carrying it, for a carrier shipment. List responses only." }),
  trackingNumber: z.string().nullable().optional().openapi({ description: "The parcel's tracking number at the carrier. List responses only." }),
  stage: z.enum(ORDER_STAGES).optional().openapi({
    description: "Where the order stands overall — its processing, then its shipment's delivery. List responses only.",
  }),
  needsAttention: z.boolean().optional().openapi({ description: "Whether the order's delivery needs the merchant. List responses only." }),
  source: OrderSourceSchema.nullable()
    .optional()
    .openapi({ description: "Where the order came from (the detail's `attribution`, in short); null when it is not known. List responses only." }),
}).openapi("OrderListItem", {
  description: "Order summary for list view - includes joins but not nested arrays",
});

// ─── Detail View (for GET /orders/{id}) ───────────────────────────────────────

/**
 * Full order detail - includes products and status history
 */
const nullableText = (description: string) => z.string().nullable().openapi({ description });

/** One visit an order's attribution describes. */
const AttributionVisitSchema = z.object({
  at: nullableText("When the shopper arrived"),
  channel: z.enum(ORDER_CHANNELS),
  platform: z.enum(ATTRIBUTION_PLATFORMS).nullable(),
  app: nullableText("The Meta app, when known"),
  referrerHost: nullableText("The other site that linked to the store, or the Android app that opened it"),
  landingPath: nullableText("The storefront path the visit landed on"),
  landingPageType: nullableText("The page type of that path"),
  utmSource: nullableText("As received"),
  utmMedium: nullableText("As received"),
  utmCampaign: nullableText("As received"),
});

/** Where an order came from (ADR 0026, attribution v2). */
export const OrderAttributionSchema = z
  .object({
    method: z.enum(ATTRIBUTION_METHODS).openapi({ description: "`captured` from the shopper's visit; `entered` for an order staff, the API or the AI agent created; `merchant` only on orders before attribution v2" }),
    channel: z.enum(ORDER_CHANNELS).nullable().openapi({ description: "Null when nothing is known. Where the order came from: the credited ad's channel (`paid_social`, `paid_search`, `paid_other`); else the channel of this visit, or of the last visit within 30 days that was neither direct nor an ad (`organic_social`, `organic_search`, `ai_assistant`, `email`, `referral`, `tagged`), else `direct`; or who entered it (`dashboard`, `api`, `agent`)" }),
    platform: z.enum(ATTRIBUTION_PLATFORMS),
    app: nullableText("The Meta app: `fb`, `ig`, `msg`, `an`, `th`, `wa`; null when unknown or not Meta"),
    legacy: z.boolean().openapi({ description: "Written with no channel: before attribution v2, or by a storefront that sent no visit. Its source is unknown (a source a merchant chose before v2 is `dashboard`)" }),
    ad: z
      .object({
        platform: z.enum(ATTRIBUTION_PLATFORMS),
        app: nullableText("The Meta app the ad ran in"),
        clickedAt: nullableText("When the shopper clicked the ad"),
        clickIdType: z.enum(CLICK_ID_TYPES).nullable(),
        campaignId: nullableText("The campaign id, from `utm_campaign` when it is digits"),
        campaignName: nullableText("The campaign name the ad URL carried (`wc_cn`)"),
        adsetId: nullableText("The ad set id, from `utm_term` when it is digits"),
        adId: nullableText("The ad id, from `utm_content` when it is digits"),
        adName: nullableText("The ad name the ad URL carried (`wc_an`)"),
        placement: nullableText("Meta's placement (`wc_pl`), as Meta sends it"),
        utmSource: nullableText("As received"),
        utmCampaign: nullableText("As received"),
        landingPath: nullableText("The storefront path the ad click landed on"),
        landingPageType: nullableText("The page type of that path: `landing`, `product`, `home`…"),
      })
      .nullable()
      .openapi({ description: "The ad the order credits: the last ad click at most 7 days before the order. Null when there is none." }),
    visit: AttributionVisitSchema.nullable().openapi({ description: "This visit: how the shopper came to the store the time they ordered, an ad or not. Null for an entered order, or one recorded before attribution v2." }),
    earlier: AttributionVisitSchema.nullable().openapi({ description: "The earlier visit the order's source comes from, when this visit was direct (or an ad too old to credit): the last visit within 30 days that was neither direct nor an ad. Null otherwise." }),
    first: AttributionVisitSchema.nullable().openapi({ description: "The shopper's first visit, as the storefront kept it. Null when not kept." }),
    firstTouchAt: nullableText("When the shopper first arrived from an ad or another site"),
  })
  .openapi("OrderAttribution");

export const OrderDetailSchema = OrderBaseSchema.extend({
  products: z.array(OrderProductSchema).optional().openapi({
    description: "Order line items. Included in GET /api/orders/{id} (detail view only).",
  }),
  statusHistory: z.array(StatusHistoryItemSchema).optional().openapi({
    description: "The order's processing as its Business Events recorded it — placed, then each status change, newest first — with who did it (a staff member's or agent's name; null for the shopper and the system). Included in GET /api/orders/{id} (detail view only).",
  }),
  shipment: ShipmentSchema.nullable().optional().openapi({
    description: "The order's delivery, with its history and the actions available now; null before handoff. Detail view only.",
  }),
  stage: z.enum(ORDER_STAGES).optional().openapi({
    description: "Where the order stands overall — its processing, then its shipment's delivery.",
  }),
  attribution: OrderAttributionSchema.nullable().optional().openapi({
    description: "Where the order came from: its channel, the ad it credits and this visit. Null when nothing is known (an order before tracking, or from a theme on an older SDK). Detail view only.",
  }),
  needsAttention: z.boolean().optional().openapi({
    description: "The merchant must act on the delivery: the carrier flagged it, the handoff outcome is unknown, or the carrier cancelled it",
  }),
  decidedByName: z.string().nullable().optional().openapi({ description: "The name of the member who first decided it" }),
  confirmedByName: z.string().nullable().optional().openapi({ description: "The name of the member credited with confirming it" }),
  assignmentHistory: z
    .array(
      z.object({
        id: z.string(),
        at: z.string(),
        to: z.object({ id: z.string(), name: z.string() }).nullable().openapi({ description: "Who it was given to; null when it was taken back to nobody" }),
        from: z.object({ id: z.string(), name: z.string() }).nullable().openapi({ description: "Who had it before" }),
        way: z.enum(ASSIGNMENT_WAYS).openapi({ description: "`automatic` by the store's rule, `manual` by a manager, `take_back` from a member who did not act in time" }),
        byName: z.string().nullable().openapi({ description: "The manager's name for a manual change; null for the store's rule" }),
      }),
    )
    .optional()
    .openapi({ description: "Who the order was given to, newest first, as its Business Events recorded it. Detail view only." }),
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
    wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID).nullable().openapi({ example: 16 }),
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
