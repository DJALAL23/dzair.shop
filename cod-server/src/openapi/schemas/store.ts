/**
 * Store & Storefront Schemas
 *
 * Store configuration, branding, Meta Pixel, and storefront-specific views.
 */

import { z } from "@hono/zod-openapi";
import { REVIEW_AUTO_PUBLISH, REVIEW_MAX_PHOTOS, REVIEW_VOICE_LENGTHS } from "../../../../cod-shared/reviews/model";
import { ProductCategoryRowSchema } from "./products";
import { MediaDeliverySchema, MediaImageSchema } from "./media";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";

/** A store language (`cod-shared/i18n/locales.ts`). */
export const StoreLocaleEnum = z.enum(STORE_LOCALES);

/**
 * A store's edits to one theme's storefront text, one map per language
 * (ADR 0005). Keys are that theme's content-pack keys.
 */
export const ContentOverridesSchema = z
  .partialRecord(StoreLocaleEnum, z.record(z.string(), z.string()))
  .openapi({
    description: "One theme's text edits per language: { [language]: { [contentKey]: text } }",
    example: { ar: { heroTitle: "توصيل مجاني لكل الولايات" }, fr: { heroTitle: "Livraison gratuite" } },
  });

/** A language the store has added (`store_locales`). */
export const StoreLanguageSchema = z
  .object({
    locale: StoreLocaleEnum,
    published: z.boolean().openapi({ description: "Shown to shoppers. Always true for the primary." }),
    primary: z.boolean(),
  })
  .openapi("StoreLanguage");

/** A served language as a storefront needs it. */
export const StorefrontLanguageSchema = z
  .object({
    code: z.string().openapi({ description: "BCP 47 language tag", example: "ar" }),
    nativeName: z.string().openapi({ description: "The language's name in itself", example: "العربية" }),
    direction: z.enum(["rtl", "ltr"]),
  })
  .openapi("StorefrontLanguage");

export const StoreSchema = z
  .object({
    id: z.string().openapi({ example: "store_01" }),
    name: z.string().openapi({ example: "My Shop" }),
    domain: z.string().nullable().openapi({ description: "Custom storefront domain", example: null }),
    logo: MediaImageSchema.nullable().openapi({ description: "The store's logo" }),
    themeId: z.string().openapi({
      description: 'The storefront theme\'s slug, e.g. "theme-00"',
      example: "theme-00",
    }),
    lang: StoreLocaleEnum.openapi({
      description: "The store's primary language: its storefront language and first fallback",
      example: "ar",
    }),
    currency: z.string().openapi({ example: "DZD" }),
    currencySymbol: z.string().openapi({ example: "دج" }),
    metaTitle: z.string().nullable().openapi({ example: "My Shop — Best Products" }),
    metaDescription: z.string().nullable().openapi({ example: "Find the best products at My Shop." }),
    ogImage: MediaImageSchema.nullable().openapi({ description: "The image links to the store show when shared" }),
    reviewsEnabled: z.boolean().openapi({
      description: "When false, reviews are hidden on the storefront and submission is disabled",
      example: true,
    }),
    reviewMaxPhotos: z.number().int().min(0).max(REVIEW_MAX_PHOTOS).openapi({
      description: "Photos a shopper may add to a review (0 = none)",
      example: 3,
    }),
    reviewVoiceMaxSeconds: z.number().int().nullable().openapi({
      description: `Longest voice note a shopper may add, in seconds (${REVIEW_VOICE_LENGTHS.join(", ")}); null = no voice notes`,
      example: 60,
    }),
    reviewAutoPublish: z.enum(REVIEW_AUTO_PUBLISH).openapi({
      description: "Which shopper reviews publish without checking: none (off), text-only ones (text_only: anything with a photo or voice note waits), or all",
      example: "text_only",
    }),
    cartEnabled: z.boolean().openapi({
      description:
        "When true the storefront renders the shopping cart alongside the direct order form",
      example: false,
    }),
    freeShippingThreshold: z.number().int().nullable().openapi({
      description: "Order subtotal (DZD) at or above which delivery is free. null = off",
      example: null,
    }),
    cartShippingMode: z.enum(["highest", "default_profile"]).openapi({
      description: "Which rate a basket spanning several shipping profiles pays",
      example: "highest",
    }),
    status: z.enum(["active", "inactive"]).openapi({ example: "active" }),
    storeApiKey: z.string().nullable().openapi({
      description:
        "Plaintext storefront API key — visible to the merchant in Store Settings. Not the dashboard API key.",
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    languages: z.array(StoreLanguageSchema).openapi({
      description: "Every language the store has added, primary first, published or not.",
    }),
  })
  .openapi("Store", {
    description:
      "Single-tenant store configuration: branding, theme, localization, SEO, and feature flags",
  });

export const StorePixelConfigSchema = z
  .object({
    id: z.string(),
    storeId: z.string(),
    pixelId: z.string().openapi({ example: "1234567890123456" }),
    adAccountName: z.string().nullable().openapi({
      description: "Merchant's own label for the Meta ad account — reference only, never sent to Meta.",
    }),
    accessTokenMasked: z.string().openapi({
      description: "Masked hint of the stored Meta access token — the token itself is write-only.",
      example: "••••a9f2",
    }),
    testEventCode: z.string().nullable().openapi({
      description: "Meta test event code — used only while Test Mode is on. Set to null in production.",
    }),
    conversionEvent: z.enum(["Purchase", "Purchase_Confirmed", "Purchase_Delivered", "Lead"]).openapi({
      description:
        "Merchant-chosen conversion event: 'Purchase' fires immediately at checkout, 'Purchase_Confirmed' fires on order confirmation, 'Purchase_Delivered' fires on confirmed delivery, and 'Lead' fires at checkout.",
    }),
    testMode: z.boolean().openapi({
      description: "When true, Conversions API events carry test_event_code to Meta's test stream.",
    }),
    enabled: z.boolean().openapi({ example: true }),
    perPageTrackingEnabled: z.boolean().openapi({
      description:
        "Master switch for per-landing-page pixels. While false (the default), every landing page reports to this pixel no matter what is configured against it — which is also this feature's rollback.",
      example: false,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("StorePixelConfig", {
    description: "Meta pixel tracking configuration for server-side conversion events",
  });

// ─── Storefront API (public, X-Store-API-Key) ─────────────────────────────────

export const StoreProductImageSchema = MediaImageSchema.extend({
  id: z.string(),
  altText: z.string().nullable().openapi({ description: "Alt text for accessibility" }),
  position: z.number().int().min(1).openapi({ description: "Display order (1 = first)" }),
}).openapi("StoreProductImage");

export const StoreReviewStatsSchema = z.object({
  avgRating: z.number().openapi({
    description: "Average rating (1.0–5.0, rounded to 1 decimal)",
    example: 4.5,
  }),
  reviewCount: z.number().int().openapi({
    description: "Number of approved reviews",
    example: 12,
  }),
});

const storeBaseFields = {
  id: z.string(),
  name: z.string().openapi({ example: "Samsung Galaxy A54" }),
  description: z.string().nullable(),
  descriptionFormat: z.enum(["text", "html"]).openapi({
    description:
      "How `description` is stored. `text` renders as literal text (legacy rows and products created without a format); `html` is sanitised rich text — render only via a strict HTML sink.",
  }),
  descriptionPlain: z.string().nullable().openapi({
    description:
      "Tag-free rendering of `description` for <meta name=description> and JSON-LD. Identical to `description` for `text` rows; null when `description` is null.",
  }),
  handle: z.string().openapi({ example: "samsung-galaxy-a54" }),
  currency: z.string().openapi({ example: "DZD" }),
  price: z.number().openapi({ example: 45000 }),
  compareAtPrice: z.number().nullable(),
  costPrice: z.null().openapi({
    description: "Always null: what the merchant paid is never served to a storefront. Kept for SDK releases that require the key.",
  }),
  type: z.enum(["PHYSICAL", "DIGITAL"]),
  hasVariants: z.boolean(),
  sku: z.string().nullable(),
  inventory: z.number().int(),
  trackInventory: z.boolean(),
  lowStockThreshold: z.number().int().openapi({
    description: "Threshold for low stock warnings",
  }),
  categoryId: z.string().nullable(),
  visibility: z.boolean(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  showInStore: z.boolean(),
  storeFeatured: z.boolean().openapi({
    description: "Deprecated: whether the product is in the `featured` collection. Kept because @wocart/storefront up to 1.7 requires it.",
  }),
  deletedAt: z.null().openapi({ description: "Always null: a removed product is never served. Kept for @wocart/storefront releases that require the field; it will be dropped" }),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metaTitle: z.string().nullable().openapi({
    description: "The title search engines and shared links show, in the requested language when translated; null: use the product's name.",
  }),
  metaDescription: z.string().nullable().openapi({
    description: "The description search engines and shared links show, in the requested language when translated; null: use `descriptionPlain`, shortened.",
  }),
};

export const StoreProductListSchema = z
  .object({
    ...storeBaseFields,
    variantOptions: z.string().nullable().openapi({
      description: "Raw JSON string — parsed before use",
    }),
    tags: z.string().nullable().openapi({
      description: "Raw JSON string array — parsed before use",
    }),
    coverImage: StoreProductImageSchema.nullable().openapi({
      description: "First image by position, or null if no images",
    }),
    reviewStats: StoreReviewStatsSchema.nullable().openapi({
      description:
        "Aggregate review stats (approved reviews only). null if no approved reviews exist for this product.",
    }),
  })
  .openapi("StoreProductList");

export const StoreQuantityPricingSchema = z
  .object({
    offerId: z.string(),
    name: z.string().openapi({ description: "The offer's name, in the requested language", example: "عروض الكمية" }),
    triggerVariantId: z.string().nullable().openapi({ description: "When set, only this variant's units count and are priced by the tiers" }),
    tiers: z
      .array(
        z.object({
          quantity: z.number().int().openapi({ example: 2 }),
          price: z.number().int().openapi({ description: "What that many units cost, in DZD", example: 3500 }),
          freeShipping: z.boolean().openapi({ description: "Delivery is free from this tier, for a basket of this product alone" }),
        }),
      )
      .openapi({ description: "In increasing quantity" }),
  })
  .openapi("StoreQuantityPricing");

export const StoreOfferSummarySchema = z.object({
  id: z.string().openapi({ description: "Offer UUID" }),
  name: z.string().openapi({
    description: "Merchant-facing offer name — display as the offer banner title.",
    example: "اشتري 2 واحصل على 1 مجاناً",
  }),
  discountType: z.enum(["free", "free_shipping"]).openapi({
    description:
      "`free` = Buy X Get Y (reward product added at $0). `free_shipping` = delivery fee waived for this order.",
  }),
  triggerQuantity: z.number().int().openapi({
    description: "Minimum quantity the customer must order to trigger the offer.",
    example: 2,
  }),
  triggerVariantId: z.string().nullable().openapi({
    description:
      "Trigger variant restriction. null = offer applies to any variant. When non-null, the offer only activates if the customer selects this specific variant.",
  }),
  rewardQuantity: z.number().int().openapi({
    description: "Number of free units of the reward product added to the order.",
    example: 1,
  }),
  rewardProductId: z.string().nullable().openapi({
    description:
      "UUID of the product given for free. null for `free_shipping` offers (no reward product).",
  }),
  rewardProductName: z.string().openapi({
    description: "Display name of the reward product. Empty string for `free_shipping` offers.",
    example: "Samsung Galaxy A54",
  }),
  rewardVariantId: z.string().nullable().openapi({
    description:
      "UUID of the specific reward variant. null = server resolves automatically (same variant as ordered when same product, or first active variant when different product).",
  }),
  rewardVariantLabel: z.string().nullable().openapi({
    description:
      "Human-readable reward variant label (e.g. 'أزرق / 128 GB'). null when no specific variant is fixed.",
  }),
  rewardUnitPrice: z.number().nullable().openapi({
    description:
      "What one gift unit is worth at list price: the reward variant's price, or the reward product's when there is no variant. The storefront states savings at this value.",
  }),
});

export const StoreProductDetailSchema = z
  .object({
    ...storeBaseFields,
    variantOptions: z
      .array(
        z.object({
          name: z.string().openapi({ example: "Color" }),
          values: z.array(
            z.object({
              value: z.string().openapi({ example: "Red" }),
              hexColor: z.string().nullable().openapi({ example: "#FF0000" }),
            })
          ),
        })
      )
      .nullable()
      .openapi({ description: "Parsed variant option axes. null for simple products." }),
    tags: z.array(z.string()).openapi({
      description: "Parsed tag list",
      example: ["sale", "new"],
    }),
    category: ProductCategoryRowSchema.nullable().openapi({
      description: "Joined category, or null if no category assigned.",
    }),
    variants: z
      .array(
        z.object({
          id: z.string(),
          productId: z.string(),
          variations: z.record(z.string(), z.string()).openapi({
            description: "Parsed key-value map of option name → value",
            example: { Color: "Red", Size: "M" },
          }),
          currency: z.string().openapi({ example: "DZD" }),
          price: z.number().openapi({ example: 45000 }),
          compareAtPrice: z.number().nullable(),
          sku: z.string().nullable(),
          barcode: z.string().nullable(),
          inventory: z.number().int(),
          lowStockThreshold: z.number().int(),
          weightKg: z.number().nullable(),
          imageId: z.string().nullable(),
          isDefault: z.boolean(),
          active: z.boolean(),
          position: z.number().int(),
          createdAt: z.string().datetime(),
          updatedAt: z.string().datetime(),
        })
      )
      .openapi({
        description: "Active variants ordered by position. Empty array for simple products.",
      }),
    images: z.array(StoreProductImageSchema).openapi({
      description: "All product images ordered by position.",
    }),
    reviewStats: StoreReviewStatsSchema.nullable().openapi({
      description:
        "Aggregate review stats (approved reviews only). null if no approved reviews exist for this product.",
    }),
    quantityPricing: StoreQuantityPricingSchema.nullable().openapi({
      description:
        "The product's live quantity pricing — price tiers by quantity — or null. A separate field from `offers` (whose kinds published SDKs validate): the highest tier the quantity reaches prices every unit at its per-unit price; the cart quote and the order charge exactly that.",
    }),
    offers: z.array(StoreOfferSummarySchema).openapi({
      description:
        "Live Buy X Get Y and free-delivery offers for this product (quantity pricing is `quantityPricing`). Only includes offers where `status=active` and the current time is within the optional schedule window. The storefront uses this list to display offer banners and to show the free reward row in the order summary when the customer selects a matching variant and quantity.",
    }),
  })
  .openapi("StoreProductDetail");

export const StorePublicTrackingSchema = z
  .object({
    pixelId: z.string().nullable().openapi({
      description:
        "The Meta Pixel to load, or null when no pixel should load at all. Public by definition — it appears in the page source. The Conversions API token is never included.",
      example: "1234567890123456",
    }),
    conversionEvent: z
      .enum(["Lead", "Purchase", "Purchase_Confirmed", "Purchase_Delivered"])
      .openapi({
        description:
          "Which moment counts as a conversion here. Inert while pixelId is null.",
        example: "Purchase",
      }),
  })
  .openapi("StorePublicTracking");

export const StoreLandingPageSchema = z
  .object({
    id: z.string().openapi({ example: "lp_abc123" }),
    slug: z.string().openapi({ example: "lp-9f3a2b1c" }),
    name: z.string().openapi({ example: "Zinc v3 — carousel ad" }),
    status: z.enum(["draft", "published", "archived"]).openapi({ example: "published" }),
    imageGap: z.number().int().openapi({ description: "Pixels between stacked images", example: 0 }),
    metaTitle: z.string().nullable().openapi({ example: "Samsung A55 — عرض خاص" }),
    metaDescription: z.string().nullable().openapi({ example: "اطلب الآن — الدفع عند الاستلام" }),
    publishedAt: z.string().datetime().nullable().openapi({ example: null }),
    images: z
      .array(
        z.object({
          id: z.string().openapi({ example: "lpimg_abc123" }),
          src: z.string().openapi({ example: "https://media.codflow.store/landing/abc.jpg" }),
          altText: z.string().nullable().openapi({ example: "عرض خاص" }),
          position: z.number().int().openapi({ example: 1 }),
        }),
      )
      .openapi({ description: "The image stack, ordered by position (1 = top)" }),
    product: StoreProductDetailSchema.nullable().openapi({
      description:
        "The product in its full store-product shape — the landing page renders the same data the product page does, so the order form works unmodified. Null when the product is no longer publicly visible.",
    }),
    tracking: StorePublicTrackingSchema.openapi({
      description:
        "Which Meta pixel THIS page loads and fires at, already resolved server-side: the page's own pixel when it has one in force, otherwise the store's. The browser never works this out for itself, so it cannot disagree with the Conversions API mirror.",
    }),
  })
  .openapi("StoreLandingPage");

export const StoreOrderTrackingSchema = z
  .object({
    pixelId: z.string().nullable().openapi({
      description: "The Meta pixel this order belongs to, or null when tracking is off.",
      example: "1234567890123456",
    }),
    event: z
      .enum(["Purchase", "Lead"])
      .nullable()
      .openapi({
        description:
          "The browser event the thank-you page should fire, or null when none should — tracking is off, or the merchant's conversion fires further down the funnel from the server only.",
        example: "Purchase",
      }),
  })
  .openapi("StoreOrderTracking");

export const StoreWhatsAppWidgetSchema = z
  .object({
    href: z.string().openapi({
      description:
        "The wa.me link, ready to use. Digits only — a '+' in the path makes WhatsApp " +
        "answer with an invalid-number page.",
      example: "https://wa.me/213551234567",
    }),
    agentName: z.string().nullable().openapi({
      description: "Who the shopper is talking to. Null means the theme uses the store name.",
      example: "أمين",
    }),
    caption: z.string().nullable().openapi({
      description: "The line under the name, e.g. how fast the merchant answers.",
      example: "نرد خلال دقائق",
    }),
    avatarUrl: z.string().nullable().openapi({
      description: "https only. Null means the theme falls back to the store logo.",
    }),
    welcomeMessage: z.string().nullable(),
    launcherLabel: z.string().nullable().openapi({
      description: "Text beside the floating launcher. Null renders the icon alone.",
    }),
    ctaLabel: z.string().nullable(),
    prefillGeneral: z.string().nullable().openapi({
      description:
        "The message WhatsApp opens with on a page that has no product. May contain " +
        "{url}, {order} and {store}, which the theme resolves from the page.",
    }),
    prefillProduct: z.string().nullable().openapi({
      description: "Same, for a product or landing page. May also contain {product}.",
      example: "سلام، بغيت نسقسي على {product}",
    }),
    accent: z.enum(["whatsapp", "primary"]).openapi({
      description: "Brand green, or the store's own primary colour.",
    }),
    position: z.enum(["right", "left"]).openapi({
      description: "Which physical side the launcher sits on, in both LTR and RTL.",
    }),
    attention: z.boolean().openapi({
      description:
        "One attention pulse per session, suppressed under prefers-reduced-motion.",
    }),
    surfaces: z
      .object({
        home: z.boolean(),
        catalog: z.boolean(),
        product: z.boolean(),
        pages: z.boolean(),
        thankYou: z.boolean(),
        checkout: z.boolean(),
        landing: z.boolean(),
      })
      .openapi({
        description:
          "Which kinds of page the launcher appears on. `checkout` and `landing` are off " +
          "by default: both already carry their own sticky order CTA, and a second " +
          "floating control competing for the same thumb costs the order.",
      }),
  })
  .openapi("StoreWhatsAppWidget");

export const StoreConfigSchema = z
  .object({
    id: z.string().openapi({ description: "Store UUID" }),
    name: z.string().openapi({ example: "متجري" }),
    domain: z.string().nullable(),
    logo: MediaImageSchema.nullable(),
    themeId: z.string().openapi({ example: "theme-00" }),
    primaryColor: z.string().openapi({
      description: "Deprecated: the value saved before colors and fonts became theme settings (migration 0047), no longer editable. Kept because @wocart/storefront up to 1.7 requires it; read `themeSettings` instead.",
      example: "#3a58ee",
    }),
    accentColor: z.string().openapi({
      description: "Deprecated: the value saved before colors and fonts became theme settings (migration 0047), no longer editable. Kept because @wocart/storefront up to 1.7 requires it; read `themeSettings` instead.",
      example: "#f59e0b",
    }),
    bgColor: z.string().openapi({
      description: "Deprecated: the value saved before colors and fonts became theme settings (migration 0047), no longer editable. Kept because @wocart/storefront up to 1.7 requires it; read `themeSettings` instead.",
      example: "#f8f8f8",
    }),
    fontFamily: z.string().openapi({
      description: "Deprecated: the value saved before colors and fonts became theme settings (migration 0047), no longer editable. Kept because @wocart/storefront up to 1.7 requires it; read `themeSettings` instead.",
      example: "Cairo, sans-serif",
    }),
    fontUrl: z.null().openapi({
      description: "Deprecated: always null. Kept because @wocart/storefront up to 1.7 requires the field; the store's font is a theme setting (`themeSettings`).",
    }),
    lang: StoreLocaleEnum.openapi({ description: "The store's primary language", example: "ar" }),
    locale: StoreLocaleEnum.openapi({
      description: "The language this config is served in: `?locale=` when the store publishes it, else `lang`",
      example: "ar",
    }),
    locales: z.array(StorefrontLanguageSchema).openapi({
      description: "The published languages, primary first",
    }),
    contentOverrides: ContentOverridesSchema.openapi({
      description: "The requesting theme's text edits for the published languages; empty without `theme`",
    }),
    themeSettings: z.record(z.string(), z.unknown()).openapi({
      description:
        "The merchant's values for the requesting theme's settings, as saved, by setting key; empty without `theme`. The theme reads them against its declaration (`resolveThemeSettings` in `@wocart/theme`), which falls back to its defaults.",
      example: { font: "Tajawal", headerMenu: "main-menu" },
    }),
    currency: z.string().openapi({ example: "DZD" }),
    currencySymbol: z.string().openapi({ example: "دج" }),
    metaTitle: z.string().nullable(),
    metaDescription: z.string().nullable(),
    ogImage: MediaImageSchema.nullable(),
    media: MediaDeliverySchema.openapi({ description: "How the storefront fetches and resizes every image key (ADR 0021)" }),
    announcementBar: z.null().openapi({
      description: "Deprecated: always null. Kept because @wocart/storefront up to 1.7 requires the field; a theme's announcement is its own setting (`themeSettings`).",
    }),
    reviewsEnabled: z.boolean().openapi({
      description: "When false, the reviews section is hidden on the storefront",
      example: true,
    }),
    cartEnabled: z.boolean().openapi({
      description:
        "When true the storefront renders the shopping cart alongside the direct " +
        "order form. False (the default) leaves the storefront exactly as it was.",
      example: false,
    }),
    freeShippingThreshold: z.number().int().nullable().openapi({
      description:
        "Order subtotal (DZD) at or above which delivery is free. null = no threshold. " +
        "Exposed so the storefront can show the promise and how far the shopper is from it.",
      example: 10000,
    }),
    otpEnabled: z.boolean().openapi({
      description:
        "When true, storefront checkout requires WhatsApp phone verification (dzverify). " +
        "True only when a store_otp_config row exists AND is enabled.",
      example: false,
    }),
    turnstileEnabled: z.boolean().openapi({
      description:
        "When true, storefront checkout requires a Cloudflare Turnstile token that the " +
        "server verifies against siteverify. True only when a store_turnstile_config row " +
        "exists AND is enabled.",
      example: false,
    }),
    turnstileSiteKey: z.string().nullable().openapi({
      description:
        "Public Turnstile widget site key for rendering the checkout widget. " +
        "null when Turnstile is disabled. The siteverify secret key is never exposed.",
      example: "0x4AAAAAAAxxxxxxxxxxxx",
    }),
    status: z.enum(["active", "inactive"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    pages: z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum(["terms", "privacy", "refund", "shipping", "custom"]),
          slug: z.string().openapi({ example: "refund-policy" }),
          title: z.string().openapi({ example: "سياسة الإرجاع والاسترجاع" }),
          position: z.number().int(),
        }),
      )
      .openapi({
        description:
          "Published pages that opt into the footer, titled in the store's own language " +
          "(stores.lang), ordered for display. The checkout consent line resolves Terms/" +
          "Refund from here by `kind`, never by a hardcoded slug — a merchant may rename " +
          "any page's slug freely.",
      }),
    legalContact: z
      .object({
        contactEmail: z.string().nullable(),
        contactPhone: z.string().nullable(),
        deliveryMinDays: z.number().int(),
        deliveryMaxDays: z.number().int(),
      })
      .nullable()
      .openapi({
        description:
          "The public subset of the store's legal profile — contact details and the " +
          "delivery window, both used in the footer and the policy pages. Null until the " +
          "merchant saves a legal profile (Settings → Store Pages); RC/NIF are never " +
          "exposed here, only inside the documents themselves.",
      }),
    checkoutForm: z
      .object({
        address: z.enum(["required", "optional"]),
        notes: z.enum(["optional", "hidden"]),
        email: z.enum(["required", "optional", "hidden"]),
        deliveryOptions: z.object({ home: z.boolean(), stopDesk: z.boolean() }),
        customFields: z.array(
          z.object({
            id: z.string().openapi({ example: "cf_a1b2c3d4" }),
            label: z.string().openapi({ example: "Preferred delivery time" }),
            type: z.enum(["text", "textarea", "number", "select"]),
            required: z.boolean(),
            options: z.array(z.string()).optional(),
          }),
        ),
      })
      .openapi({
        description:
          "The merchant's order-form configuration, already resolved: a store that never " +
          "customised it gets the defaults, which describe the form exactly as it behaved " +
          "before this feature existed. The theme renders this and holds no form rules of " +
          "its own — cod-server enforces every one of them on POST /store/orders, so a " +
          "hidden field posted from an edge-cached page is dropped and a required one " +
          "refuses the order. The raw stored column is never exposed.",
      }),
    whatsapp: StoreWhatsAppWidgetSchema.nullable().openapi({
      description:
        "The WhatsApp contact widget, already resolved — or null, which is what a store " +
        "gets when the widget is off, has no number, or holds a number that no longer " +
        "normalises. A theme's entire gate is this being non-null and the current surface " +
        "being on in `surfaces`. The raw stored column is never exposed.",
    }),
  })
  .openapi("StoreConfig");

export const StorePagePublicSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["terms", "privacy", "refund", "shipping", "custom"]),
    slug: z.string().openapi({ example: "refund-policy" }),
    locale: StoreLocaleEnum.openapi({
      description:
        "The locale actually served — the store's own language, or the fallback locale " +
        "when that translation doesn't exist (see legal/render.ts's resolution order).",
    }),
    title: z.string(),
    bodyHtml: z.string().openapi({
      description: "Sanitised HTML. Render with set:html and never re-sanitise.",
    }),
    metaTitle: z.string().nullable(),
    metaDescription: z.string().nullable(),
  })
  .openapi("StorePagePublic");
