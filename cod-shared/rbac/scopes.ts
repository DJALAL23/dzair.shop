/**
 * Centralized Scope Definitions for RBAC System
 * 
 * This file defines all permission scopes used throughout the application.
 * Scopes follow the format: resource:action
 * 
 * These definitions are shared between frontend and backend to ensure
 * consistent permission checking across the entire system.
 */

export const SCOPES = {
  // Dashboard
  /** View dashboard overview and statistics */
  DASHBOARD_VIEW: "dashboard:view",
  
  // Orders
  /** View orders list and order details */
  ORDERS_READ: "orders:read",
  /** Create new orders */
  ORDERS_CREATE: "orders:create",
  /** Update order status and details */
  ORDERS_UPDATE: "orders:update",
  /** Cancel or delete orders */
  ORDERS_DELETE: "orders:delete",
  /** Assign orders to drivers */
  ORDERS_ASSIGN: "orders:assign",
  
  // Customers
  /** View customers list and customer profiles */
  CUSTOMERS_READ: "customers:read",
  /** Create new customers */
  CUSTOMERS_CREATE: "customers:create",
  /** Update customer information */
  CUSTOMERS_UPDATE: "customers:update",
  /** Delete customers */
  CUSTOMERS_DELETE: "customers:delete",
  
  // Products
  /** View products catalog */
  PRODUCTS_READ: "products:read",
  /** Create new products */
  PRODUCTS_CREATE: "products:create",
  /** Update product information */
  PRODUCTS_UPDATE: "products:update",
  /** Delete products */
  PRODUCTS_DELETE: "products:delete",
  /** Manage product variations and inventory */
  PRODUCTS_MANAGE: "products:manage",
  
  // Delivery
  /** View drivers and delivery information */
  DELIVERY_READ: "delivery:read",
  /** Create new drivers */
  DELIVERY_CREATE: "delivery:create",
  /** Update driver information */
  DELIVERY_UPDATE: "delivery:update",
  /** Delete drivers */
  DELIVERY_DELETE: "delivery:delete",
  /** Assign orders to drivers */
  DELIVERY_ASSIGN: "delivery:assign",
  /** Manage drivers and delivery settings */
  DELIVERY_MANAGE: "delivery:manage",
  /** Dispatch orders to third-party delivery company APIs (create shipments) */
  DELIVERY_DISPATCH: "delivery:dispatch",
  
  // Customer Groups
  /** View customer groups */
  CUSTOMER_GROUPS_READ: "customer_groups:read",
  /** Create, update, delete customer groups and manage members */
  CUSTOMER_GROUPS_MANAGE: "customer_groups:manage",

  // Customer Tags
  /** View customer tags */
  CUSTOMER_TAGS_READ: "customer_tags:read",
  /** Create, update, delete customer tags and manage assignments */
  CUSTOMER_TAGS_MANAGE: "customer_tags:manage",

  // Product Groups
  /** View product groups and collections */
  PRODUCT_GROUPS_READ: "product_groups:read",
  /** Create, update, delete product groups */
  PRODUCT_GROUPS_MANAGE: "product_groups:manage",

  // Stock
  /** View stock levels and movement history */
  STOCK_READ: "stock:read",
  /** Adjust stock quantities */
  STOCK_MANAGE: "stock:manage",


  // Settings
  /** View settings pages */
  SETTINGS_VIEW: "settings:view",
  /** Manage team members and permissions */
  SETTINGS_TEAM: "settings:team",

  // Reviews
  /** View product reviews and their moderation status */
  REVIEWS_READ: "reviews:read",
  /** Approve, reject, and delete product reviews, remove a review's photo or voice note, and set the store's review rules (the Reviews App) */
  REVIEWS_MANAGE: "reviews:manage",
  /** Enter a review a customer gave the store (by WhatsApp, phone, in person) */
  REVIEWS_CREATE: "reviews:create",

  // Offers
  /** View promotional offers list */
  OFFERS_READ: "offers:read",
  /** Create, update, and delete promotional offers */
  OFFERS_MANAGE: "offers:manage",

  // Coupons (codes a shopper enters at checkout)
  /** View coupons, their uses and the discount they gave */
  COUPONS_READ: "coupons:read",
  /** Create, update, and delete coupons */
  COUPONS_MANAGE: "coupons:manage",

  // Checkout Form (the storefront order form: which fields it asks for, how
  // strictly each is enforced, and the merchant's own custom fields)
  /** View the checkout form policy */
  CHECKOUT_FORM_READ: "checkout_form:read",
  /** Change which fields the storefront order form asks for, and manage custom fields */
  CHECKOUT_FORM_MANAGE: "checkout_form:manage",

  // Apps (cod-shared/apps): one pair per App, named by its App Key
  /** See the Meta App: its pixel, its conversions and how they are delivered */
  META_READ: "meta:read",
  /** Set up, turn on or off and remove the Meta App; start, stop and replay Meta conversions */
  META_MANAGE: "meta:manage",
  /** See the DZVerify App: whether the phone check runs and in which language */
  DZVERIFY_READ: "dzverify:read",
  /** Set up, test, turn on or off and remove the DZVerify App */
  DZVERIFY_MANAGE: "dzverify:manage",
  /** See the Turnstile App: whether the bot check runs and its site key */
  TURNSTILE_READ: "turnstile:read",
  /** Set up, turn on or off and remove the Turnstile App */
  TURNSTILE_MANAGE: "turnstile:manage",
  /** See the Order Protection App: its rules, Block List and Spam Orders */
  ORDER_PROTECTION_READ: "order-protection:read",
  /** Change the Order Protection App's rules and Block List, and rescue or delete Spam Orders */
  ORDER_PROTECTION_MANAGE: "order-protection:manage",
  /** See the Sendili App: whether the store sends email and from which address */
  SENDILI_READ: "sendili:read",
  /** Set up, test, turn on or off and remove the Sendili App */
  SENDILI_MANAGE: "sendili:manage",
  /** See the WhatsApp button App: the number, what the chat panel shows and where */
  WHATSAPP_BUTTON_READ: "whatsapp-button:read",
  /** Change the WhatsApp button's number, content, look and placement, and remove it */
  WHATSAPP_BUTTON_MANAGE: "whatsapp-button:manage",
  /** See the Telegram App: its bot, the chat it reaches, which events it tells and in which language */
  TELEGRAM_READ: "telegram:read",
  /** Connect, test, steer and disconnect the Telegram App's bot */
  TELEGRAM_MANAGE: "telegram:manage",

  // Integrations (the merchant's own systems: webhooks and the API key)
  /** See the store's webhooks and how their deliveries went */
  INTEGRATIONS_READ: "integrations:read",
  /** Add, edit, test, stop, replay and delete webhooks, and rotate their signing secrets */
  INTEGRATIONS_MANAGE: "integrations:manage",

  // Store Pages (legal pages: Terms, Privacy, Refund, Shipping, and custom pages)
  /** View store pages list, content, and the legal profile */
  STORE_PAGES_READ: "store_pages:read",
  /** Create, edit, publish, delete store pages; manage the legal profile */
  STORE_PAGES_MANAGE: "store_pages:manage",

  // Collections (curated product lists: Featured, Best sellers, New arrivals…)
  /** View collections and their products */
  COLLECTIONS_READ: "collections:read",
  /** Create, rename, order and delete collections */
  COLLECTIONS_MANAGE: "collections:manage",

  // Navigation (the store's menus: header, footer, and any a theme reads)
  /** View the store's menus and their items */
  NAVIGATION_READ: "navigation:read",
  /** Create, rename, edit and delete menus */
  NAVIGATION_MANAGE: "navigation:manage",

  // Abandoned Orders
  /** View abandoned orders list and stats */
  ABANDONED_ORDERS_READ: "abandoned_orders:read",
  /** Update status and delete abandoned order records */
  ABANDONED_ORDERS_MANAGE: "abandoned_orders:manage",

  // Landing Pages
  /** View landing pages list, stats, and comparison view */
  LANDING_PAGES_READ: "landing_pages:read",
  /** Create, edit, publish, and delete landing pages */
  LANDING_PAGES_MANAGE: "landing_pages:manage",

  // MCP (remote AI agents via Model Context Protocol)
  /**
   * Access the /mcp page to view and manage your OWN connected AI apps
   * (Claude Desktop, Claude.ai, ChatGPT, etc.). Can see your own MCP URL,
   * your consent grants, and revoke your own connections. Does NOT let
   * the holder see other team members' connections — that's admin-only.
   */
  MCP_VIEW: "mcp:view",

  // Wildcard (admin only)
  /** All permissions - admin users only */
  ALL: "*",
} as const;

/**
 * Type representing any valid scope string
 */
export type Scope = typeof SCOPES[keyof typeof SCOPES];

/**
 * Array of all defined scopes (excluding wildcard)
 */
export const ALL_SCOPES = Object.values(SCOPES).filter(scope => scope !== "*");

/**
 * Scope categories for UI grouping
 */
export const SCOPE_CATEGORIES = {
  dashboard: {
    label: "Dashboard",
    scopes: [SCOPES.DASHBOARD_VIEW],
  },
  orders: {
    label: "Orders",
    scopes: [
      SCOPES.ORDERS_READ,
      SCOPES.ORDERS_CREATE,
      SCOPES.ORDERS_UPDATE,
      SCOPES.ORDERS_DELETE,
      SCOPES.ORDERS_ASSIGN,
    ],
  },
  customers: {
    label: "Customers",
    scopes: [
      SCOPES.CUSTOMERS_READ,
      SCOPES.CUSTOMERS_CREATE,
      SCOPES.CUSTOMERS_UPDATE,
      SCOPES.CUSTOMERS_DELETE,
    ],
  },
  customerGroups: {
    label: "Customer Groups",
    scopes: [SCOPES.CUSTOMER_GROUPS_READ, SCOPES.CUSTOMER_GROUPS_MANAGE],
  },
  customerTags: {
    label: "Customer Tags",
    scopes: [SCOPES.CUSTOMER_TAGS_READ, SCOPES.CUSTOMER_TAGS_MANAGE],
  },
  products: {
    label: "Products",
    scopes: [
      SCOPES.PRODUCTS_READ,
      SCOPES.PRODUCTS_CREATE,
      SCOPES.PRODUCTS_UPDATE,
      SCOPES.PRODUCTS_DELETE,
      SCOPES.PRODUCTS_MANAGE,
    ],
  },
  delivery: {
    label: "Delivery",
    scopes: [
      SCOPES.DELIVERY_READ,
      SCOPES.DELIVERY_CREATE,
      SCOPES.DELIVERY_UPDATE,
      SCOPES.DELIVERY_DELETE,
      SCOPES.DELIVERY_ASSIGN,
      SCOPES.DELIVERY_MANAGE,
      SCOPES.DELIVERY_DISPATCH,
    ],
  },
  productGroups: {
    label: "Product Groups",
    scopes: [SCOPES.PRODUCT_GROUPS_READ, SCOPES.PRODUCT_GROUPS_MANAGE],
  },
  stock: {
    label: "Stock",
    scopes: [SCOPES.STOCK_READ, SCOPES.STOCK_MANAGE],
  },
  reviews: {
    label: "Reviews",
    scopes: [SCOPES.REVIEWS_READ, SCOPES.REVIEWS_MANAGE, SCOPES.REVIEWS_CREATE],
  },
  offers: {
    label: "Offers",
    scopes: [SCOPES.OFFERS_READ, SCOPES.OFFERS_MANAGE],
  },
  coupons: {
    label: "Coupons",
    scopes: [SCOPES.COUPONS_READ, SCOPES.COUPONS_MANAGE],
  },
  storePages: {
    label: "Store Pages",
    scopes: [SCOPES.STORE_PAGES_READ, SCOPES.STORE_PAGES_MANAGE],
  },
  collections: {
    label: "Collections",
    scopes: [SCOPES.COLLECTIONS_READ, SCOPES.COLLECTIONS_MANAGE],
  },
  navigation: {
    label: "Navigation",
    scopes: [SCOPES.NAVIGATION_READ, SCOPES.NAVIGATION_MANAGE],
  },
  checkoutForm: {
    label: "Checkout Form",
    scopes: [SCOPES.CHECKOUT_FORM_READ, SCOPES.CHECKOUT_FORM_MANAGE],
  },
  abandonedOrders: {
    label: "Abandoned Orders",
    scopes: [SCOPES.ABANDONED_ORDERS_READ, SCOPES.ABANDONED_ORDERS_MANAGE],
  },
  landingPages: {
    label: "Landing Pages",
    scopes: [SCOPES.LANDING_PAGES_READ, SCOPES.LANDING_PAGES_MANAGE],
  },
  mcp: {
    label: "AI Agents (MCP)",
    scopes: [SCOPES.MCP_VIEW],
  },
  apps: {
    label: "Apps",
    scopes: [
      SCOPES.META_READ,
      SCOPES.META_MANAGE,
      SCOPES.DZVERIFY_READ,
      SCOPES.DZVERIFY_MANAGE,
      SCOPES.TURNSTILE_READ,
      SCOPES.TURNSTILE_MANAGE,
      SCOPES.ORDER_PROTECTION_READ,
      SCOPES.ORDER_PROTECTION_MANAGE,
      SCOPES.SENDILI_READ,
      SCOPES.SENDILI_MANAGE,
      SCOPES.WHATSAPP_BUTTON_READ,
      SCOPES.WHATSAPP_BUTTON_MANAGE,
      SCOPES.TELEGRAM_READ,
      SCOPES.TELEGRAM_MANAGE,
    ],
  },
  integrations: {
    label: "Integrations",
    scopes: [SCOPES.INTEGRATIONS_READ, SCOPES.INTEGRATIONS_MANAGE],
  },
  settings: {
    label: "Settings",
    scopes: [SCOPES.SETTINGS_VIEW, SCOPES.SETTINGS_TEAM],
  },
} as const;
