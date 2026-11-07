/**
 * OpenAPI Schemas - Central Export
 *
 * Clean, organized domain-based schema structure.
 * All schemas are organized by domain in separate files under schemas/*.ts
 *
 * Domain organization:
 * - common.ts: Response wrappers (Error, Success, List, Message)
 * - reference.ts: Algerian administrative data (Wilaya, Commune)
 * - users.ts: Team members and auth
 * - activity.ts: Audit logs
 * - customers.ts: Customer profiles, groups, tags
 * - products.ts: Products, variants, categories, stock, offers
 * - delivery.ts: Delivery companies, drivers, stop desks, shipping
 * - reviews.ts: Product reviews
 * - store.ts: Store config, branding, storefront views
 * - orders.ts: Orders, shipments, abandoned orders
 */

import { z } from "@hono/zod-openapi";

// ─── Common Response Wrappers ─────────────────────────────────────────────────

export {
  // Error
  ErrorResponseSchema,
  
  // Success wrappers
  SuccessResponseSchema,
  SuccessWithMessageSchema,
  MessageResponseSchema,
  
  // List wrappers
  ListResponseSchema,
  ListWithTotalResponseSchema,
  
  // Utilities
  IdParamSchema,
  PaginationQuerySchema,
} from "./schemas/common";

// ─── Reference Data ───────────────────────────────────────────────────────────

export {
  WilayaSchema,
  CommuneSchema,
} from "./schemas/reference";

// ─── Users ────────────────────────────────────────────────────────────────────

export {
  UserSchema,
} from "./schemas/users";

// ─── Activity Logs ────────────────────────────────────────────────────────────

export {
  ActivityLogSchema,
} from "./schemas/activity";

// ─── Reviews ──────────────────────────────────────────────────────────────────

export {
  ReviewSchema,
} from "./schemas/reviews";

// ─── Customers ────────────────────────────────────────────────────────────────

export {
  CustomerSchema,
  CustomerGroupMemberSchema,
  CustomerOrderSummarySchema,
  CustomerGroupMembershipSchema,
  CustomerTagMembershipSchema,
  CustomerGroupSchema,
  CustomerTagCustomerSchema,
  CustomerTagSchema,
} from "./schemas/customers";

// ─── Delivery & Logistics ─────────────────────────────────────────────────────

export {
  DeliveryCompanySchema,
  StopDeskSchema,
  ShippingRuleSchema,
  ShippingProfileWithRulesSchema,
  ShippingProfileSchema,
  CommuneOverrideSchema,
  DriverSchema,
  DriverCompensationRowSchema,
  DriverPaymentSchema,
  PendingSettlementSchema,
} from "./schemas/delivery";

// ─── Products ─────────────────────────────────────────────────────────────────

export {
  ProductCategoryRowSchema,
  ProductCategorySchema,
  ProductVariantOptionSchema,
  ProductImageSchema,
  ProductVariantSchema,
  ProductSchema,
  ProductDetailSchema,
  ProductRemovalSchema,
  StockMovementSchema,
  StockAlertItemSchema,
  StockOverviewSchema,
  OfferSchema,
} from "./schemas/products";

// ─── Media ────────────────────────────────────────────────────────────────────

export {
  MediaKeySchema,
  MediaImageSchema,
  MediaDeliverySchema,
  UploadRequestSchema,
  UploadTicketSchema,
  UploadReportSchema,
} from "./schemas/media";

// ─── Landing Pages ────────────────────────────────────────────────────────────

export {
  LandingPageStatusEnum,
  LandingPageImageSchema,
  LandingPageSchema,
  LandingPageListItemSchema,
  LandingPageTrackingSchema,
  LandingPageTrackingActivitySchema,
  LandingPageTrackingStateSchema,
} from "./schemas/landing-pages";

// ─── Store Pages ──────────────────────────────────────────────────────────────

export {
  StorePageKindEnum,
  StorePageStatusEnum,
  PageLocaleEnum,
  TranslationSourceEnum,
  StorePageTranslationSummarySchema,
  StorePageSummarySchema,
  StorePageTranslationBodySchema,
  StorePageDetailSchema,
  StoreLegalProfileSchema,
} from "./schemas/store-pages";

// ─── Store & Storefront ───────────────────────────────────────────────────────

export {
  StoreLocaleEnum,
  ContentOverridesSchema,
  StoreLanguageSchema,
  StorefrontLanguageSchema,
  StoreSchema,
  StorePixelConfigSchema,
  StoreProductImageSchema,
  StoreReviewStatsSchema,
  StoreProductListSchema,
  StoreOfferSummarySchema,
  StoreProductDetailSchema,
  PageDocumentSchema,
  StoreLandingPageSchema,
  StorePublicTrackingSchema,
  StoreOrderTrackingSchema,
  StoreWhatsAppWidgetSchema,
  StoreConfigSchema,
  StorePagePublicSchema,
} from "./schemas/store";

// ─── Orders ───────────────────────────────────────────────────────────────────

export {
  // Enums
  OrderStatusEnum,
  DeliveryTypeEnum,
  OrderTypeEnum,
  OrderProductStatusEnum,
  
  // Entity schemas
  StatusHistoryItemSchema,
  OrderProductSchema,
  OrderListItemSchema,
  OrderDetailSchema,
  OrderSchema, // Alias for backward compatibility
  OrderRemovalSchema,
  
  // Abandoned orders
  AbandonedOrderStatusEnum,
  AbandonedOrderSchema,
  AbandonedOrderStatsSchema,
  
  // Response data schemas
  OrderCreatedDataSchema,
  ReturnProductDataSchema,
  
  // Types
  type OrderStatus,
  type DeliveryType,
  type OrderType,
  type OrderProductStatus,
} from "./schemas/orders";

export {
  EventConsumerSchema,
  EventDeliverySchema,
  EventDeliveryAttemptSchema,
  EventDeliveryDetailSchema,
  RedeliverySchema,
  SigningSecretSchema,
  WebhookCreatedSchema,
  WebhookTestSchema,
} from "./schemas/event-consumers";
