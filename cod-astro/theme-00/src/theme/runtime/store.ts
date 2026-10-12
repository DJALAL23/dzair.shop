// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CUSTOMIZE HERE (Custom mode) — DEFAULT_CONFIG only                  ║
// ║  Edit DEFAULT_CONFIG to change fallback colors/font/meta when the    ║
// ║  API is unreachable. The read itself goes through the theme adapter  ║
// ║  (src/theme/sdk.ts) — the one place an SDK client is created.        ║
// ╚══════════════════════════════════════════════════════════════════════╝
/**
 * Per-request store data helpers.
 * Call once per page — pass the returned config to StoreLayout to avoid
 * duplicate API fetches.
 *
 * The config comes from the SDK client behind the theme adapter, so a
 * successful read is cached for the client's lifetime (one fetch per isolate,
 * not one per render) and any failure still falls back to DEFAULT_CONFIG.
 */
import { getStoreClient } from "@/theme/sdk";
import { resolveContent } from "@/theme/content";
import type { StoreConfig } from "@codflow/storefront";
import type { StoreFrontContent } from "@/theme/content";

export const DEFAULT_CONFIG: StoreConfig = {
  id: "",
  name: "متجري",
  domain: null,
  logoUrl: null,
  themeId: "theme01",
  primaryColor: "#7c3aed",
  accentColor: "#f59e0b",
  bgColor: "#f8f8f8",
  fontFamily: "Cairo, sans-serif",
  fontUrl: null,
  lang: "ar",
  currency: "DZD",
  currencySymbol: "دج",
  contentJson: null,
  metaTitle: null,
  metaDescription: null,
  ogImage: null,
  announcementBar: null,
  reviewsEnabled: true,
  cartEnabled: false,
  freeShippingThreshold: null,
  otpEnabled: false,
  turnstileEnabled: false,
  turnstileSiteKey: null,
  status: "active",
  cartShippingMode: "highest",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  // Mirrors CustomerFields' built-in default, so the API-unreachable path
  // renders the exact form it rendered before the policy feature existed.
  checkoutForm: {
    address: "optional",
    notes: "optional",
    email: "hidden",
    deliveryOptions: { home: true, stopDesk: true },
    customFields: [],
  },
  pixelId: null,
  conversionEvent: "Purchase",
  pages: [],
  legalContact: null,
  whatsapp: null,
};

export interface StoreContext {
  config: StoreConfig;
  /** The theme's pack for `locale`, with the store's overrides merged. */
  content: StoreFrontContent;
  /** The language this request renders (BCP 47): today, the store's language. */
  locale: string;
  /**
   * Languages to try after `locale` for a translated page value (ADR 0005).
   * Empty while a store serves one language: its pack, already in the right
   * language, is a better fallback than another language's text.
   */
  fallbackLocales: readonly string[];
  isRTL: boolean;
}

export async function getStoreContext(): Promise<StoreContext> {
  const config = (await getStoreClient().config.get()) ?? DEFAULT_CONFIG;
  const content = resolveContent(config.lang, config.contentJson);
  const isRTL = config.lang === "ar";
  return { config, content, locale: config.lang, fallbackLocales: [], isRTL };
}
