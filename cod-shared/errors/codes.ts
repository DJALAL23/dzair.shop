/**
 * Shared Error Codes and Categories
 * 
 * Centralized error code registry for the COD platform.
 * Used by both backend (cod-server) and frontend (cod-client-astro).
 */

export const ERROR_CODES = {
  // ============================================================================
  // VALIDATION ERRORS (400, 422)
  // ============================================================================
  VALIDATION_FAILED: "VALIDATION_FAILED",
  REQUIRED_FIELD_MISSING: "REQUIRED_FIELD_MISSING",
  INVALID_FORMAT: "INVALID_FORMAT",
  VALUE_OUT_OF_RANGE: "VALUE_OUT_OF_RANGE",
  INVALID_UUID: "INVALID_UUID",
  INVALID_EMAIL_FORMAT: "INVALID_EMAIL_FORMAT",
  INVALID_PHONE_FORMAT: "INVALID_PHONE_FORMAT",
  
  // ============================================================================
  // AUTHENTICATION ERRORS (401, 403)
  // ============================================================================
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_API_KEY: "INVALID_API_KEY",
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  USER_INACTIVE: "USER_INACTIVE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  UNAUTHORIZED: "UNAUTHORIZED",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - GENERAL (404, 409, 422)
  // ============================================================================
  ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
  DUPLICATE_ENTITY: "DUPLICATE_ENTITY",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - MCP MANAGEMENT
  // ============================================================================
  MCP_CONNECTION_NOT_FOUND: "MCP_CONNECTION_NOT_FOUND",
  MCP_CLIENT_NOT_FOUND: "MCP_CLIENT_NOT_FOUND",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - CUSTOMERS
  // ============================================================================
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",
  CUSTOMER_HAS_ORDERS: "CUSTOMER_HAS_ORDERS",
  DUPLICATE_PHONE: "DUPLICATE_PHONE",
  
  // ============================================================================
  // BUSINESS EVENTS
  // ============================================================================
  BUSINESS_EVENT_NOT_FOUND: "BUSINESS_EVENT_NOT_FOUND",
  EVENT_CONSUMER_NOT_FOUND: "EVENT_CONSUMER_NOT_FOUND",
  EVENT_DELIVERY_NOT_FOUND: "EVENT_DELIVERY_NOT_FOUND",
  /** A disabled Consumer receives nothing: start it again before replaying to it. */
  EVENT_CONSUMER_DISABLED: "EVENT_CONSUMER_DISABLED",
  /** The Delivery is already on its way. */
  EVENT_DELIVERY_ALREADY_DUE: "EVENT_DELIVERY_ALREADY_DUE",
  /** A built-in Consumer is kept by its App: it can be started and stopped, nothing more. */
  EVENT_CONSUMER_BUILT_IN: "EVENT_CONSUMER_BUILT_IN",
  /** The store has as many webhook Consumers as it may. */
  EVENT_CONSUMER_LIMIT_REACHED: "EVENT_CONSUMER_LIMIT_REACHED",

  // ============================================================================
  // TELEGRAM APP
  // ============================================================================
  /** Telegram does not know the token as a bot's, or it is not shaped like one. */
  TELEGRAM_TOKEN_REFUSED: "TELEGRAM_TOKEN_REFUSED",
  /** No bot is saved yet. */
  TELEGRAM_NOT_SET_UP: "TELEGRAM_NOT_SET_UP",
  /** The bot is saved, but no chat has pressed Start on a pairing link yet. */
  TELEGRAM_NOT_CONNECTED: "TELEGRAM_NOT_CONNECTED",
  /** Telegram only sends updates to https: the server's public URL (`WORKER_SELF_URL`) is not one. */
  TELEGRAM_NEEDS_PUBLIC_URL: "TELEGRAM_NEEDS_PUBLIC_URL",
  /** Telegram refused the call for good: what it said is in the error. */
  TELEGRAM_REFUSED: "TELEGRAM_REFUSED",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - ORDERS
  // ============================================================================
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  ORDER_NOT_READY_FOR_HANDOFF: "ORDER_NOT_READY_FOR_HANDOFF",
  /** Units refused at the door are recorded on a delivered order only. */
  ORDER_NOT_DELIVERED: "ORDER_NOT_DELIVERED",
  ORDER_HAS_SHIPMENT: "ORDER_HAS_SHIPMENT",
  ORDER_NOT_FINISHED: "ORDER_NOT_FINISHED",
  ORDER_CHANGED: "ORDER_CHANGED",
  /** A checkout key already placed an order for another phone: it is never merged into it. */
  CHECKOUT_KEY_IN_USE: "CHECKOUT_KEY_IN_USE",
  MISSING_WILAYA_COMMUNE: "MISSING_WILAYA_COMMUNE",
  MISSING_STATION_CODE: "MISSING_STATION_CODE",
  MISSING_ADDRESS: "MISSING_ADDRESS",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - LANDING PAGES
  // ============================================================================
  LANDING_PAGE_HAS_ORDERS: "LANDING_PAGE_HAS_ORDERS",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - STORE PAGES
  // ============================================================================
  /** A legal page (terms/privacy/refund/shipping) can be unpublished but never deleted. */
  STORE_PAGE_CANNOT_DELETE_LEGAL: "STORE_PAGE_CANNOT_DELETE_LEGAL",
  /** "Reset to template" requested on a custom page, which has no template. */
  STORE_PAGE_NOT_LEGAL: "STORE_PAGE_NOT_LEGAL",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - PRODUCTS
  // ============================================================================
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  DUPLICATE_SKU: "DUPLICATE_SKU",
  VARIANT_NOT_FOUND: "VARIANT_NOT_FOUND",
  VARIANT_HAS_ORDERS: "VARIANT_HAS_ORDERS",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - DRIVERS
  // ============================================================================
  DRIVER_NOT_FOUND: "DRIVER_NOT_FOUND",
  DRIVER_HAS_ACTIVE_ORDERS: "DRIVER_HAS_ACTIVE_ORDERS",
  DRIVER_HAS_SHIPMENTS: "DRIVER_HAS_SHIPMENTS",
  DRIVER_UNAVAILABLE: "DRIVER_UNAVAILABLE",
  DRIVER_COMPENSATION_NOT_FOUND: "DRIVER_COMPENSATION_NOT_FOUND",
  PAYMENT_ALREADY_SETTLED: "PAYMENT_ALREADY_SETTLED",
  SHIPMENT_NOT_SETTLEABLE: "SHIPMENT_NOT_SETTLEABLE",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - DELIVERY COMPANIES
  // ============================================================================
  COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
  COMPANY_INACTIVE: "COMPANY_INACTIVE",
  COMPANY_HAS_ACTIVE_SHIPMENTS: "COMPANY_HAS_ACTIVE_SHIPMENTS",
  COMPANY_HAS_SHIPMENTS: "COMPANY_HAS_SHIPMENTS",
  PROVIDER_NOT_SUPPORTED: "PROVIDER_NOT_SUPPORTED",
  MISSING_API_CREDENTIALS: "MISSING_API_CREDENTIALS",
  SHIPMENT_CREATION_FAILED: "SHIPMENT_CREATION_FAILED",
  SHIPMENT_VALIDATION_FAILED: "SHIPMENT_VALIDATION_FAILED",
  SHIPMENT_UPDATE_FAILED: "SHIPMENT_UPDATE_FAILED",
  SHIPMENT_CANCEL_FAILED: "SHIPMENT_CANCEL_FAILED",
  SHIPMENT_NOT_FOUND: "SHIPMENT_NOT_FOUND",
  SHIPMENT_CLOSED: "SHIPMENT_CLOSED",
  SHIPMENT_NOT_VOIDABLE: "SHIPMENT_NOT_VOIDABLE",
  SHIPMENT_REPORT_NOT_ALLOWED: "SHIPMENT_REPORT_NOT_ALLOWED",
  SHIPMENT_HANDOFF_PENDING: "SHIPMENT_HANDOFF_PENDING",
  SHIPMENT_ACTION_NOT_AVAILABLE: "SHIPMENT_ACTION_NOT_AVAILABLE",
  OPERATION_NOT_SUPPORTED: "OPERATION_NOT_SUPPORTED",
  CARRIER_REJECTED: "CARRIER_REJECTED",
  CARRIER_AUTH_FAILED: "CARRIER_AUTH_FAILED",
  CARRIER_RATE_LIMITED: "CARRIER_RATE_LIMITED",
  CARRIER_UNAVAILABLE: "CARRIER_UNAVAILABLE",
  CARRIER_OUTCOME_UNKNOWN: "CARRIER_OUTCOME_UNKNOWN",
  CARRIER_MISCONFIGURED: "CARRIER_MISCONFIGURED",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - STOREFRONT OTP VERIFICATION (dzverify)
  // ============================================================================
  /** Store OTP verification is not enabled for this store. */
  OTP_NOT_ENABLED: "OTP_NOT_ENABLED",
  /** Order submission carried no OTP token while verification is enabled. */
  OTP_VERIFICATION_REQUIRED: "OTP_VERIFICATION_REQUIRED",
  /** OTP token failed signature/expiry verification. */
  OTP_TOKEN_INVALID: "OTP_TOKEN_INVALID",
  /** OTP token phone does not match the order phone (normalized E.164). */
  OTP_PHONE_MISMATCH: "OTP_PHONE_MISMATCH",
  /** dzverify balance too low — send failed (order proceeds unverified via bypass). */
  OTP_QUOTA_EXHAUSTED: "OTP_QUOTA_EXHAUSTED",
  /** dzverify rate limit hit — retry after the window in context. */
  OTP_RATE_LIMITED: "OTP_RATE_LIMITED",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - STOREFRONT TURNSTILE (checkout bot protection)
  // ============================================================================
  /** Order submission carried no Turnstile token while Turnstile is enabled. */
  TURNSTILE_VERIFICATION_REQUIRED: "TURNSTILE_VERIFICATION_REQUIRED",
  /** Turnstile token failed siteverify (invalid, expired, or already redeemed). */
  TURNSTILE_TOKEN_INVALID: "TURNSTILE_TOKEN_INVALID",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - STOCK
  // ============================================================================
  STOCK_RECORD_NOT_FOUND: "STOCK_RECORD_NOT_FOUND",
  NEGATIVE_STOCK_NOT_ALLOWED: "NEGATIVE_STOCK_NOT_ALLOWED",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - CUSTOMER GROUPS
  // ============================================================================
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  GROUP_HAS_MEMBERS: "GROUP_HAS_MEMBERS",
  DUPLICATE_GROUP_NAME: "DUPLICATE_GROUP_NAME",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - CUSTOMER TAGS
  // ============================================================================
  TAG_NOT_FOUND: "TAG_NOT_FOUND",
  TAG_HAS_ASSIGNMENTS: "TAG_HAS_ASSIGNMENTS",
  DUPLICATE_TAG_NAME: "DUPLICATE_TAG_NAME",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - USERS
  // ============================================================================
  USER_NOT_FOUND: "USER_NOT_FOUND",
  DUPLICATE_EMAIL: "DUPLICATE_EMAIL",
  INVALID_ROLE: "INVALID_ROLE",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - OFFERS
  // ============================================================================
  OFFER_NOT_FOUND: "OFFER_NOT_FOUND",
  OFFER_EXPIRED: "OFFER_EXPIRED",
  OFFER_NOT_ACTIVE: "OFFER_NOT_ACTIVE",
  /** The offer the write would leave is incoherent: a gift with no gift, tiers out of bounds, a schedule ending before it starts, a variant of another product. */
  INVALID_OFFER: "INVALID_OFFER",
  /** Quantity pricing scheduled beside another live offer for the same product: a product gets one offer per order. */
  OFFER_CONFLICT: "OFFER_CONFLICT",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - COUPONS
  // ============================================================================
  /** The coupon the write would leave is incoherent, or names a product, collection, customer or group that does not exist. */
  INVALID_COUPON: "INVALID_COUPON",
  /** Another coupon already has this code. */
  COUPON_CODE_TAKEN: "COUPON_CODE_TAKEN",
  /** The code the order carries does not apply to it; `reason` says why (`CouponRefusal`), with `shortBy` or `startsAt` when there is one. */
  COUPON_NOT_APPLICABLE: "COUPON_NOT_APPLICABLE",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - REVIEWS
  // ============================================================================
  REVIEW_NOT_FOUND: "REVIEW_NOT_FOUND",
  ORDER_ALREADY_REVIEWED: "ORDER_ALREADY_REVIEWED",
  /** The product is not one the order may review: never in it, refused at the door, or no longer in the catalog. */
  PRODUCT_NOT_IN_ORDER: "PRODUCT_NOT_IN_ORDER",
  /** The store turned reviews off. */
  REVIEWS_DISABLED: "REVIEWS_DISABLED",
  /** The order has not reached its customer yet; it can be reviewed once delivered. */
  REVIEW_ORDER_NOT_DELIVERED: "REVIEW_ORDER_NOT_DELIVERED",
  /** Too many attempts for one order in a short time. */
  REVIEW_RATE_LIMITED: "REVIEW_RATE_LIMITED",
  /** Too many order look-ups for one order, or from one shopper, in a short time. */
  ORDER_LOOKUP_RATE_LIMITED: "ORDER_LOOKUP_RATE_LIMITED",
  /** The upload grant is missing, altered, for another order, or past its end. */
  REVIEW_UPLOAD_GRANT_INVALID: "REVIEW_UPLOAD_GRANT_INVALID",
  /** A named upload was never received, or was already cleaned away. */
  REVIEW_UPLOAD_NOT_FOUND: "REVIEW_UPLOAD_NOT_FOUND",
  /** More photos than the store allows, a second voice note, or a kind the store does not take. */
  REVIEW_MEDIA_LIMIT: "REVIEW_MEDIA_LIMIT",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - SHIPPING PROFILES
  // ============================================================================
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_IN_USE: "PROFILE_IN_USE",
  DELIVERY_NOT_AVAILABLE: "DELIVERY_NOT_AVAILABLE",
  SHIPPING_PROFILE_NOT_FOUND: "SHIPPING_PROFILE_NOT_FOUND",
  SHIPPING_RULE_NOT_FOUND: "SHIPPING_RULE_NOT_FOUND",
  COMMUNE_OVERRIDE_NOT_FOUND: "COMMUNE_OVERRIDE_NOT_FOUND",
  DEFAULT_PROFILE_REQUIRED: "DEFAULT_PROFILE_REQUIRED",
  DUPLICATE_WILAYA_RULE: "DUPLICATE_WILAYA_RULE",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - COLLECTIONS
  // ============================================================================
  COLLECTION_NOT_FOUND: "COLLECTION_NOT_FOUND",
  /** Another collection of the store already has this handle. */
  DUPLICATE_COLLECTION_HANDLE: "DUPLICATE_COLLECTION_HANDLE",
  /** Too many products, one product twice, or a product that does not exist. */
  INVALID_COLLECTION_PRODUCTS: "INVALID_COLLECTION_PRODUCTS",

  // ============================================================================
  // BUSINESS LOGIC ERRORS - NAVIGATION MENUS
  // ============================================================================
  MENU_NOT_FOUND: "MENU_NOT_FOUND",
  /** Another menu of the store already has this handle. */
  DUPLICATE_MENU_HANDLE: "DUPLICATE_MENU_HANDLE",
  /** Items nested deeper than a menu allows, or more items than it holds, or one item twice. */
  INVALID_MENU_ITEMS: "INVALID_MENU_ITEMS",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - PRODUCT GROUPS
  // ============================================================================
  PRODUCT_GROUP_NOT_FOUND: "PRODUCT_GROUP_NOT_FOUND",
  PRODUCT_GROUP_HAS_PRODUCTS: "PRODUCT_GROUP_HAS_PRODUCTS",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - WILAYAS
  // ============================================================================
  WILAYA_NOT_FOUND: "WILAYA_NOT_FOUND",
  COMMUNE_NOT_FOUND: "COMMUNE_NOT_FOUND",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - STORES
  // ============================================================================
  STORE_NOT_FOUND: "STORE_NOT_FOUND",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - IMAGES
  // ============================================================================
  IMAGE_NOT_FOUND: "IMAGE_NOT_FOUND",
  INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - WEBHOOKS
  // ============================================================================
  INVALID_WEBHOOK_PAYLOAD: "INVALID_WEBHOOK_PAYLOAD",
  WEBHOOK_PROCESSING_FAILED: "WEBHOOK_PROCESSING_FAILED",
  
  // ============================================================================
  // BUSINESS LOGIC ERRORS - PAYMENTS
  // ============================================================================
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  
  // ============================================================================
  // SYSTEM ERRORS (500, 502, 503)
  // ============================================================================
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  EXTERNAL_API_FAILURE: "EXTERNAL_API_FAILURE",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export const ERROR_CATEGORIES = {
  VALIDATION: "VALIDATION",
  AUTHENTICATION: "AUTHENTICATION",
  BUSINESS_LOGIC: "BUSINESS_LOGIC",
  SYSTEM: "SYSTEM",
} as const;

export type ErrorCategory = typeof ERROR_CATEGORIES[keyof typeof ERROR_CATEGORIES];
