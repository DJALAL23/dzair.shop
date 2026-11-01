/**
 * Store API Routes
 *
 * Public storefront surface (a theme on @wocart/storefront, e.g. Theme-00). Authenticated globally via
 * storeAuthMiddleware (X-Store-API-Key) applied to /store/* in src/index.ts —
 * a different credential from the dashboard X-API-Key.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import * as h from "./handlers";
import { COUPON_REFUSAL_REASONS } from "../../../../cod-shared/queries/checkout-coupon";
import { STOREFRONT_PRODUCT_SORTS } from "../../../../cod-shared/queries/store";
import { THEME_KEY_RE } from "../../../../cod-shared/i18n/content-overrides";
import { PAGE_DOCUMENT_SURFACE_RE } from "../../../../cod-shared/queries/page-document-surface";
import { storeOrderSchema, validateCartSchema } from "./validation";
import reviewsRouter from "./reviews/routes";
import { orderNumber as orderNumberSchema, phone as orderPhoneSchema } from "./reviews/validation";
import { SHOPPER_ORDER_STAGES } from "../../../../cod-shared/orders/shopper-stage";
import { MenuHandleSchema, StorefrontMenuSchema } from "@/openapi/schemas/menus";
import { CollectionHandleSchema, StorefrontCollectionSchema } from "@/openapi/schemas/collections";
import {
  StoreConfigSchema,
  StoreProductListSchema,
  StoreProductDetailSchema,
  PageDocumentSchema,
  StoreLandingPageSchema,
  StoreOrderTrackingSchema,
  StorePagePublicSchema,
  ProductCategoryRowSchema,
  SuccessResponseSchema,
} from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const countEnvelope = <T extends z.ZodType>(itemSchema: T) =>
  jsonContent(
    z.object({
      success: z.boolean().openapi({ example: true }),
      data: z.array(itemSchema),
      count: z.number().int().openapi({ description: "Number of items in `data`" }),
    })
  );

/** A page of a listing: what it holds, and how many the whole listing holds. */
const pageEnvelope = <T extends z.ZodType>(itemSchema: T) =>
  jsonContent(
    z.object({
      success: z.boolean().openapi({ example: true }),
      data: z.array(itemSchema),
      count: z.number().int().openapi({ description: "Number of items in `data`" }),
      total: z.number().int().openapi({ description: "Number of products in the whole listing, across its pages" }),
    })
  );

// ─── Request schemas ──────────────────────────────────────────────────────────

/**
 * `?locale=` on every read that carries merchant text (ADR 0005). A language
 * the store does not publish is not an error: the read is served in the
 * primary, and `Content-Language` says so.
 */
const localeQuery = z.string().max(35).optional().openapi({
  description:
    "The language to serve merchant text in (BCP 47, e.g. `fr`). Served when the store publishes it, the primary language otherwise; the `Content-Language` response header names the one served. Untranslated fields fall back to the primary one by one.",
  example: "fr",
});

const localeQuerySchema = z.object({ locale: localeQuery });

const orderLocaleQuerySchema = z.object({
  locale: z.string().max(35).optional().openapi({
    description:
      "The language the shopper checked out in (BCP 47, e.g. `fr`): recorded on the order, and the language its customer messages are written in, when the store publishes it; the primary language otherwise. The `Content-Language` response header names the one recorded.",
    example: "fr",
  }),
});

const configQuerySchema = z.object({
  locale: localeQuery,
  theme: z.string().regex(THEME_KEY_RE).optional().openapi({
    description:
      "The requesting theme's key (`defineTheme({ key })`). Its text edits ride along as `contentOverrides`; without it there are none.",
    example: "theme-00",
  }),
});

const productsQuerySchema = z.object({
  collection: CollectionHandleSchema.optional().openapi({
    description: "Only this collection's products (by handle), in the merchant's order. An unknown handle lists nothing.",
  }),
  onSale: z.enum(["true", "false"]).optional().openapi({
    description: "When true, only products priced below their compare-at price.",
  }),
  categoryId: z.string().optional().openapi({ description: "Filter by category ID." }),
  sort: z.enum(STOREFRONT_PRODUCT_SORTS).optional().openapi({
    description: "The order: `newest`, `price-ascending` or `price-descending`. Absent: a collection's own order, a search's best match first, else newest.",
  }),
  limit: z.coerce.number().int().min(1).max(100).default(24).openapi({
    description: "Maximum number of products to return. Server cap: 100.",
  }),
  offset: z.coerce.number().int().min(0).default(0).openapi({
    description: "Products to skip, for paging through the whole catalog (e.g. a sitemap).",
  }),
  locale: localeQuery,
});

const searchQuerySchema = productsQuerySchema.extend({
  q: z.string().trim().min(1).max(100).openapi({
    description: "What the shopper typed. Every word must be in the product's name — the catalog's or the requested language's — or its tags; case is ignored for Latin letters.",
    example: "robe coton",
  }),
});

const handleParams = z.object({
  handle: z.string().openapi({ example: "samsung-galaxy-a54" }),
});

const lpSlugParams = z.object({
  slug: z.string().openapi({ example: "lp-9f3a2b1c" }),
});

const landingQuerySchema = z.object({
  locale: localeQuery,
  theme: z.string().regex(THEME_KEY_RE).optional().openapi({
    description: "The requesting theme's key (`defineTheme({ key })`): the page's own document for that theme comes with it.",
    example: "theme-00",
  }),
  preview: z.enum(["1"]).optional().openapi({
    description: "`1` for an editor's preview: a draft page answers too, and no visit is counted. Never sent for a shopper's page.",
    example: "1",
  }),
});

const pageSlugParams = z.object({
  slug: z.string().openapi({ example: "refund-policy" }),
});

const menuHandleParams = z.object({ handle: MenuHandleSchema });

const pageDocumentParams = z.object({
  surface: z.string().regex(PAGE_DOCUMENT_SURFACE_RE).openapi({ example: "home" }),
});

const pageDocumentQuerySchema = z.object({
  theme: z.string().regex(THEME_KEY_RE).optional().openapi({
    description:
      "The requesting theme's key (`defineTheme({ key })`): its document for the surface. Without it, the most recently saved document for the surface, whichever theme wrote it.",
    example: "theme-00",
  }),
});


const wilayaIdParams = z.object({
  wilayaId: z.coerce.number().int().min(1).max(58).openapi({
    description: "Wilaya number (1–58).",
    example: 16,
  }),
});

// ─── Config ───────────────────────────────────────────────────────────────────

const getStoreConfigRoute = defineRoute({
  method: "get",
  path: "/config",
  auth: "store",
  tags: ["Store API"],
  summary: "Get store configuration",
  description:
    "Get store settings used by the storefront (theme, locale, branding).",
  operationId: "getStoreConfig",
  query: configQuerySchema,
  responses: {
    200: {
      description: "Store configuration",
      content: jsonContent(SuccessResponseSchema(StoreConfigSchema)),
    },
  },
  handler: h.getStoreConfig,
});

// ─── Catalog ──────────────────────────────────────────────────────────────────

const listStoreProductsRoute = defineRoute({
  method: "get",
  path: "/products",
  auth: "store",
  tags: ["Store API"],
  summary: "List store products",
  description:
    "Get the public product catalog for the storefront. Only returns products where `status=ACTIVE`, `showInStore=true` and `visibility=true`.",
  operationId: "listStoreProducts",
  query: productsQuerySchema,
  responses: {
    200: {
      description: "List of products",
      content: pageEnvelope(StoreProductListSchema),
    },
  },
  handler: h.listStoreProducts,
});

const searchStoreProductsRoute = defineRoute({
  method: "get",
  path: "/search",
  auth: "store",
  tags: ["Store API"],
  summary: "Search store products",
  description:
    "The products a shopper's words find, with the list endpoint's gates, filters, paging and sort; without a `sort`, products whose name holds every word come first. Its own path, so a server without search answers 404 rather than the whole catalog.",
  operationId: "searchStoreProducts",
  query: searchQuerySchema,
  responses: {
    200: {
      description: "The products found",
      content: pageEnvelope(StoreProductListSchema),
    },
  },
  handler: h.searchStoreProducts,
});

const getStoreProductRoute = defineRoute({
  method: "get",
  path: "/products/{handle}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get store product",
  description:
    "Get a single product by its URL handle. Same visibility filters as the list endpoint. Returns parsed `variantOptions`, `tags`, joined `category`, active `variants`, all `images`, and `offers` — the active Buy X Get Y promotions currently applicable to this product.",
  operationId: "getStoreProduct",
  params: handleParams,
  query: localeQuerySchema,
  responses: {
    200: {
      description: "Product details",
      content: jsonContent(SuccessResponseSchema(StoreProductDetailSchema)),
    },
  },
  handler: h.getStoreProduct,
});

const getStoreLandingPageRoute = defineRoute({
  method: "get",
  path: "/landing-pages/{slug}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get published landing page",
  description:
    "Get a published landing page by its public slug: the ordered image stack, spacing settings, the linked product in its full store-product shape (variants, offers, inventory) in the requested language (`?locale=`), so the storefront order form works unmodified, and the page's own document for the requesting `?theme=`. Store-hidden products (`showInStore=false`) still render here — the landing page is their sales channel; the catalog list and the product's own page stay hidden. Draft/archived/unknown slugs return 404; with `?preview=1` a draft answers too. Each successful GET increments the page's view counter (non-unique in v1), except a preview.",
  operationId: "getStoreLandingPage",
  params: lpSlugParams,
  query: landingQuerySchema,
  responses: {
    200: {
      description: "Published landing page with its product",
      content: jsonContent(SuccessResponseSchema(StoreLandingPageSchema)),
    },
    404: { description: "Landing page not found, draft, or archived" },
  },
  handler: h.getStoreLandingPage,
});

const getStorePageRoute = defineRoute({
  method: "get",
  path: "/pages/{slug}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get a published store page",
  description:
    "Get a Terms/Privacy/Refund/Shipping/custom page by its public slug, in the requested language (`?locale=`, else the store's primary). Falls back to the primary, then to whichever locale exists, only when the requested language has no translation for this page; the actual locale served is in the response's `locale` field. Draft or unknown slugs return 404 — never a soft 200 with empty content.",
  operationId: "getStorePage",
  params: pageSlugParams,
  query: localeQuerySchema,
  responses: {
    200: {
      description: "The resolved page, already-sanitised HTML — render with set:html, never re-sanitise",
      content: jsonContent(SuccessResponseSchema(StorePagePublicSchema)),
    },
    404: { description: "Page not found, or exists only as a draft" },
  },
  handler: h.getStorePage,
});

const getStoreCollectionRoute = defineRoute({
  method: "get",
  path: "/collections/{handle}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get a collection",
  description:
    "A collection's title and description for its page (`/collections/:handle`), in the requested language (`?locale=`, else the store's primary). Its products come from `/store/products?collection=`. An unknown handle is a 404: the theme answers a real 404 page.",
  operationId: "getStoreCollection",
  params: z.object({ handle: CollectionHandleSchema }),
  query: localeQuerySchema,
  responses: {
    200: { description: "The collection", content: jsonContent(SuccessResponseSchema(StorefrontCollectionSchema)) },
    404: { description: "The store has no collection with this handle" },
  },
  handler: h.getStoreCollection,
});

const getStoreMenuRoute = defineRoute({
  method: "get",
  path: "/menus/{handle}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get a menu",
  description:
    "A navigation menu by handle, as a shopper sees it: labels in the requested language (`?locale=`, else the store's primary), each item's `href` a path of the store without a language prefix (or the merchant's URL). An item whose destination is deleted or not public is left out with its children. An unknown handle is a 404: the theme then renders its own fallback.",
  operationId: "getStoreMenu",
  params: menuHandleParams,
  query: localeQuerySchema,
  responses: {
    200: { description: "The menu", content: jsonContent(SuccessResponseSchema(StorefrontMenuSchema)) },
    404: { description: "The store has no menu with this handle" },
  },
  handler: h.getStoreMenu,
});

const getStorePageDocumentRoute = defineRoute({
  method: "get",
  path: "/page-documents/{surface}",
  auth: "store",
  tags: ["Store API"],
  summary: "Get the store's saved page document",
  description:
    "The store's saved composition for one theme and surface (a page such as `home` or `product`, an area such as `area:header`, or one landing page's `lp:<id>`), written by Wocart Cloud's editor and read verbatim. `data` is `null` when the store has never saved one, or when the saved row is not a document for this surface: the theme then renders its own default. A store that has none is a normal answer, so it is a 200, not a 404.",
  operationId: "getStorePageDocument",
  params: pageDocumentParams,
  query: pageDocumentQuerySchema,
  responses: {
    200: {
      description: "The saved document, or null when there is none",
      content: jsonContent(SuccessResponseSchema(PageDocumentSchema.nullable())),
    },
    400: { description: "The surface name is not a valid surface key" },
  },
  handler: h.getStorePageDocument,
});

const getStoreOrderTrackingRoute = defineRoute({
  method: "get",
  path: "/orders/{id}/tracking",
  auth: "store",
  tags: ["Store API"],
  summary: "Get an order's tracking destination",
  description: `Which Meta pixel this order belongs to, and which browser event the thank-you page should fire for it.

The thank-you page cannot work this out for itself: it knows the order id and nothing about which landing page the shopper came from, and landing-page attribution is best-effort — an unknown, draft or archived slug leaves the order unattributed. A browser deciding independently would fire at a pixel the Conversions API never mirrors to, and Meta deduplicates per pixel, so that produces two conversions in two ad accounts instead of one.

Returns the decision, not the configuration. \`event\` is null when no browser event should fire — either tracking is off, or the merchant's conversion fires further down the funnel (phone confirmation, delivery) from the server only.

Deliberately narrow: nothing about the order itself is returned, and never an access token.`,
  operationId: "getStoreOrderTracking",
  params: z.object({
    id: z.string().openapi({ description: "Order UUID", example: "ord_abc123" }),
  }),
  responses: {
    200: {
      description: "The order's tracking destination",
      content: jsonContent(SuccessResponseSchema(StoreOrderTrackingSchema)),
    },
    404: { description: "Order not found" },
  },
  handler: h.getStoreOrderTracking,
});

const listStoreCategoriesRoute = defineRoute({
  method: "get",
  path: "/categories",
  auth: "store",
  tags: ["Store API"],
  summary: "List store categories",
  description: "Get product categories ordered by position.",
  operationId: "listStoreCategories",
  query: localeQuerySchema,
  responses: {
    200: {
      description: "List of categories",
      content: countEnvelope(ProductCategoryRowSchema),
    },
  },
  handler: h.listStoreCategories,
});

// ─── Shipping ─────────────────────────────────────────────────────────────────

const getShippingRatesRoute = defineRoute({
  method: "get",
  path: "/shipping-rates",
  auth: "store",
  tags: ["Store API"],
  summary: "Get shipping rates",
  description:
    "Per-wilaya shipping rates for the order form. Returns wilayas that have a rule in the default shipping profile; absent wilayas should be treated as unknown/unsupported.",
  operationId: "getShippingRates",
  responses: {
    200: {
      description: "Shipping rates keyed by wilaya ID (as string)",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.record(
            z.string(),
            z.object({
              home: z.number().openapi({
                description: "Home delivery price (DZD)",
                example: 400,
              }),
              stopDesk: z.number().openapi({
                description: "Stop-desk / post-office pickup price (DZD)",
                example: 350,
              }),
            })
          ),
        })
      ),
    },
  },
  handler: h.getShippingRates,
});

const communesRoute = defineRoute({
  method: "get",
  path: "/communes/{wilayaId}",
  auth: "store",
  tags: ["Store API"],
  summary: "List communes for a wilaya",
  description:
    "Get all communes for a given wilaya. Use the returned `id` as `communeId` when submitting an order.",
  operationId: "listStoreCommunes",
  params: wilayaIdParams,
  responses: {
    200: {
      description: "List of communes for the wilaya",
      content: countEnvelope(
        z.object({
          id: z.string().openapi({
            description: "Commune ID — use as `communeId` in POST /store/orders. Format is not UUID.",
            example: "c-16-001",
          }),
          name: z.string().openapi({ example: "Bab El Oued" }),
          nameAr: z.string().openapi({ example: "باب الوادي" }),
        })
      ),
    },
    400: { description: "Invalid wilaya ID — must be 1–58 (VALUE_OUT_OF_RANGE)" },
  },
  handler: h.listStoreCommunes,
});

// ─── Orders ───────────────────────────────────────────────────────────────────

const createStoreOrderRoute = defineRoute({
  method: "post",
  path: "/orders",
  auth: "store",
  tags: ["Store API"],
  summary: "Create store order",
  description: `Submit a customer order from the public storefront. Finds or creates the customer by phone number.

**Basket (\`items\`):** send \`items\` to order several products in one go — up to 20 distinct lines, each up to 100 units. Lines with the same product AND variant are merged and their quantities summed. When \`items\` is absent the flat \`productId\`/\`quantity\` fields are used, so existing integrations are unaffected.

**Pricing is server-authoritative.** \`pricePerUnit\` is accepted for UI continuity and never trusted; every line is priced from the catalog row.

**All or nothing.** If any line cannot be satisfied — insufficient stock, missing SKU — the whole order is refused and nothing is written.

**Delivery fee** is resolved per basket: a product's own shipping profile overrides the store default, a commune-level override beats the wilaya rule, and a basket spanning two profiles pays the highest applicable rate. Delivery is refused (not silently free) when any product cannot be shipped to the destination.

**Offer selection:** send \`offerId\` to explicitly select the tier the customer chose. It is honoured only if it independently qualifies — reached, and able to give its benefit; otherwise the server picks the highest threshold that qualifies. Trigger quantity counts a product across all its lines, so two variants of one shirt are two shirts.

**Buy X Get Y (\`discountType: "free"\`):** the reward product is appended as a \`$0\` line item. A reward the stock cannot cover makes its offer not qualify: the product falls to its next offer and the order still succeeds. Reward lines never trigger further offers.

**Coupon (\`couponCode\`):** applied after offers, to the paid lines in its scope that no offer applied to; its discount is shared across those lines, so \`price\` is net of it, and a free-delivery coupon makes \`deliveryFee\` 0. A code that does not apply refuses the whole order with COUPON_NOT_APPLICABLE (\`reason\`, with \`shortBy\` or \`startsAt\` when there is one) — the order is never placed without it. Its uses are counted by the database as the order is inserted, so two orders cannot take the last one.

**Free Shipping (\`discountType: "free_shipping"\`):** the delivery fee is overridden to 0 — reflected in both \`deliveryFee\` and \`total\`. This applies only when the basket holds a **single distinct product**; in a multi-product basket free delivery is earned by the store's basket threshold instead, so one cheap promotional item cannot ship an expensive basket for free.

**One checkout, one order (\`checkoutKey\`):** a UUID the shopper's browser stamps on the checkout attempt. Sent again — a double click, a resubmitted form, a retried request — it answers with the order already placed, as it answered the first time, without placing another; for another phone it is refused with CHECKOUT_KEY_IN_USE. Without it, every request places an order.

**Multi-unit variant orders:** when different variants are selected per unit, send \`variantSelections\` — one entry per unit. Identical variants are grouped into a single line and inventory deducts per-variant.`,
  operationId: "createStoreOrder",
  query: orderLocaleQuerySchema,
  body: storeOrderSchema,
  responses: {
    201: {
      description: "Order created",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.object({
            orderId: z.string(),
            orderNumber: z.string().openapi({ example: "ORD-20260327-0042" }),
            price: z.number(),
            deliveryFee: z.number(),
            total: z.number().openapi({ description: "price + deliveryFee, offers and coupon applied" }),
            couponDiscount: z.number().int().openapi({ description: "What the coupon took off; 0 without one" }),
          }),
        })
      ),
    },
    404: { description: "Referenced SKU/product record missing (REQUIRED_FIELD_MISSING)" },
    409: { description: "The checkout key already placed an order for another phone (CHECKOUT_KEY_IN_USE)" },
    422: {
      description:
        "Insufficient stock (INSUFFICIENT_STOCK), missing SKU before accepting orders, or a coupon that does not apply (COUPON_NOT_APPLICABLE)",
    },
  },
  handler: h.createStoreOrder,
});

// ─── Cart ─────────────────────────────────────────────────────────────────────

const ShopperOrderStatusSchema = z
  .object({
    orderNumber: z.string(),
    placedAt: z.string().openapi({ description: "When the order was placed (ISO 8601)" }),
    stage: z.enum(SHOPPER_ORDER_STAGES).openapi({
      description:
        "Where the order is, in the shopper's words: `placed` (not confirmed yet), `confirmed`, `preparing`, `shipped`, `out_for_delivery`, `delivered`, `returned` (refused at the door) or `cancelled`.",
    }),
    deliveryType: z.enum(["home", "stop_desk"]),
    lines: z.array(
      z.object({
        name: z.string().openapi({ description: "As it was sold, in the catalog's language" }),
        variantLabel: z.string().nullable(),
        quantity: z.number().int(),
      }),
    ),
    total: z.number().openapi({ description: "What the shopper pays on delivery" }),
    tracking: z
      .object({ number: z.string(), carrier: z.string().nullable() })
      .nullable()
      .openapi({ description: "The carrier's tracking number once the parcel is with it; null before, or with the store's own driver" }),
  })
  .openapi("ShopperOrderStatus");

const shopperOrderStatusRoute = defineRoute({
  method: "post",
  path: "/orders/status",
  auth: "store",
  tags: ["Store API"],
  summary: "Find where a shopper's order is",
  description:
    "The order's number and the phone it was placed with prove it is the shopper's, as for a review; a wrong number and a wrong phone both answer 404 ORDER_NOT_FOUND. Attempts are limited per order and per shopper (ORDER_LOOKUP_RATE_LIMITED, with `windowSeconds`). The answer is what a shopper may know — the step it is at, its lines and total, and the carrier's tracking number once shipped — never the address, the notes or the merchant's own statuses. A POST, so the phone never sits in a URL or a log.",
  operationId: "getShopperOrderStatus",
  body: z.object({ orderNumber: orderNumberSchema, phone: orderPhoneSchema }),
  responses: {
    200: { description: "The order's status", content: jsonContent(SuccessResponseSchema(ShopperOrderStatusSchema)) },
    404: { description: "No order has this number and phone" },
  },
  handler: h.getShopperOrderStatus,
});

const validateCartRoute = defineRoute({
  method: "post",
  path: "/cart/validate",
  auth: "store",
  tags: ["Store API"],
  summary: "Re-price and check a basket — the quote of an order",
  description: [
    "Read-only. Returns what the catalog says about a basket right now, so the cart can show the truth before the shopper commits. Nothing is written and no stock is reserved.",
    "",
    "The body names what is being ordered in the order's own fields: a basket (`items[]`), or one product — `productId`, `productName`, `quantity`, optionally `variantId`, a variant per unit (`variantSelections`) and an offer tier (`offerId`). A product page asks with exactly what its form will post, and the lines are built the same way the order builds them.",
    "",
    "Every line comes back with its CURRENT catalog price, the units still available (`maxQuantity`, null when the product is not stock-tracked), and a `blocker` when it cannot be ordered as requested:",
    "",
    "- `missing`: the product no longer exists",
    "- `unlisted`: it is no longer on sale (draft, hidden or removed)",
    "- `out_of_stock`: fewer units are available than requested",
    "",
    "Blocked lines are excluded from `subtotal`, from offer evaluation and from the free-delivery calculation, so the basket never promises something checkout would refuse.",
    "",
    "`freeDelivery` is subtotal-based and therefore answerable before the shopper types an address: use `remaining` for a \"spend X more\" prompt.",
    "",
    "Send `destination` (`wilayaId`, optional `communeId`, `deliveryType`) and the answer carries `delivery`: the fee and the total the order would charge there, from the same quote the order itself uses — product shipping profiles, commune overrides, the free-delivery threshold and free-shipping offers included. `available: false` (fee and total null) means the store does not deliver there, and an order to it is refused with DELIVERY_NOT_AVAILABLE. Without `destination`, there is no `delivery` field.",
    "",
    "Send `couponCode` and the answer carries `coupon`: applied (with the `discount` taken off the lines, each line's share in its `discount`, and whether it makes delivery free) or refused with the `reason` the order would be refused for. Send `phone` once the shopper has typed it, so a coupon for selected customers, or one use per customer, is judged before the order. Without `couponCode`, `coupon` is null.",
    "",
    "Product names and variant labels come from the catalog, in the language `?locale=` asks for (the store's primary when it does not publish that language), announced in `Content-Language`. The order itself records the catalog's names in the store's primary language.",
  ].join("\n"),
  operationId: "validateStoreCart",
  query: localeQuerySchema,
  body: validateCartSchema,
  responses: {
    200: {
      description: "Basket priced and checked against the live catalog",
      content: jsonContent(
        z.object({
          success: z.boolean().openapi({ example: true }),
          data: z.object({
            lines: z.array(
              z.object({
                productId: z.string(),
                variantId: z.string().nullable(),
                variantLabel: z.string().nullable(),
                productName: z.string(),
                quantity: z.number().int(),
                unitPrice: z.number().openapi({ description: "The catalog's unit price" }),
                lineTotal: z.number().openapi({ description: "What the line costs, offers and coupon applied" }),
                offerId: z.string().nullable().openapi({ description: "The offer applied to the line; null when none" }),
                offerName: z.string().nullable().openapi({ description: "That offer's name, in the shopper's language" }),
                discount: z.number().int().openapi({ description: "The line's share of the coupon's discount, already out of `lineTotal`" }),
                maxQuantity: z.number().int().nullable(),
                blocker: z
                  .enum(["missing", "unlisted", "out_of_stock"])
                  .nullable(),
              }),
            ),
            subtotal: z.number(),
            rewards: z.array(
              z
                .object({
                  offerId: z.string(),
                  offerName: z.string().nullable().openapi({ description: "The offer's name, in the shopper's language" }),
                  productId: z.string().nullable(),
                  productName: z.string().nullable(),
                  variantId: z.string().nullable().openapi({ description: "The variant given, when the product has variants" }),
                  variantLabel: z.string().nullable(),
                  quantity: z.number().int(),
                })
                .openapi({ description: "A gift the basket earns, as it will be given: its product and variant, free" }),
            ),
            freeDelivery: z.object({
              fromOffer: z.boolean(),
              threshold: z.number().int().nullable().openapi({ description: "The store's free-delivery amount; null when it has none" }),
              qualified: z.boolean().openapi({ description: "Delivery is free for this basket, wherever it goes: by an offer, the coupon or the store's amount" }),
              remaining: z.number().openapi({ description: "How much more to spend for the store's free delivery; 0 once delivery is free, or with no amount" }),
              by: z.enum(["offer", "coupon", "threshold"]).nullable().openapi({ description: "Why delivery is free; null when it is not" }),
            }),
            coupon: z
              .union([
                z.object({ code: z.string(), applied: z.literal(true), discount: z.number().int(), freeShipping: z.boolean() }),
                z.object({
                  code: z.string(),
                  applied: z.literal(false),
                  reason: z.enum(COUPON_REFUSAL_REASONS),
                  shortBy: z.number().int().optional().openapi({ description: "Dinars, or items, the covered lines still lack" }),
                  startsAt: z.string().optional(),
                }),
              ])
              .nullable()
              .openapi({ description: "The code's outcome; null without `couponCode`." }),
            delivery: z
              .object({
                available: z.boolean(),
                fee: z.number().nullable(),
                total: z.number().nullable(),
              })
              .optional()
              .openapi({ description: "Present only when the request names a destination." }),
          }),
        }),
      ),
    },
    400: { description: "Basket exceeds its bounds (VALUE_OUT_OF_RANGE)" },
  },
  handler: h.validateCart,
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new OpenAPIHono<AppContext>();

router.openapi(getStoreConfigRoute.route, getStoreConfigRoute.handler);
router.openapi(getStoreMenuRoute.route, getStoreMenuRoute.handler);
router.openapi(getStoreCollectionRoute.route, getStoreCollectionRoute.handler);
router.openapi(listStoreProductsRoute.route, listStoreProductsRoute.handler);
router.openapi(searchStoreProductsRoute.route, searchStoreProductsRoute.handler);
router.openapi(getStoreProductRoute.route, getStoreProductRoute.handler);
router.openapi(getStoreLandingPageRoute.route, getStoreLandingPageRoute.handler);
router.openapi(getStorePageRoute.route, getStorePageRoute.handler);
router.openapi(getStorePageDocumentRoute.route, getStorePageDocumentRoute.handler);
router.openapi(getStoreOrderTrackingRoute.route, getStoreOrderTrackingRoute.handler);
router.openapi(shopperOrderStatusRoute.route, shopperOrderStatusRoute.handler);
router.openapi(listStoreCategoriesRoute.route, listStoreCategoriesRoute.handler);
router.openapi(getShippingRatesRoute.route, getShippingRatesRoute.handler);
router.openapi(communesRoute.route, communesRoute.handler);
router.openapi(createStoreOrderRoute.route, createStoreOrderRoute.handler);
router.openapi(validateCartRoute.route, validateCartRoute.handler);
router.route("/reviews", reviewsRouter);

export default router;
