// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CUSTOMIZE HERE (Custom mode) — DEFAULT_CONFIG only                  ║
// ║  Edit DEFAULT_CONFIG to change the fallback store name/meta when the ║
// ║  API is unreachable (colors and font are settings: settings.ts).     ║
// ║  The read itself goes through the theme adapter                      ║
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
import { getStoreClient, type PreviewDraft, type StoreClient } from "@/theme/sdk";
import { resolveContent } from "@/theme/content";
import { localizeHref, servedLanguage, type LocaleRouting, type StoreConfig } from "@wocart/storefront";
import { resolvePreviewStore as resolvePreview, resolveStoreRequest as resolveRequest, type ResolvedStore } from "@wocart/storefront/astro";
import type { StoreFrontContent } from "@/theme/content";

export const DEFAULT_CONFIG: StoreConfig = {
  id: "",
  name: "متجري",
  domain: null,
  logoUrl: null,
  themeId: "theme-00",
  primaryColor: "#7c3aed",
  accentColor: "#f59e0b",
  bgColor: "#f8f8f8",
  fontFamily: "Cairo, sans-serif",
  fontUrl: null,
  lang: "ar",
  locale: "ar",
  currency: "DZD",
  currencySymbol: "دج",
  locales: [{ code: "ar", nativeName: "العربية", direction: "rtl" }],
  contentOverrides: {},
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
  /** The language this request renders: the URL's (`/fr/…`), else the primary. */
  locale: string;
  /**
   * Languages to try after `locale` for a translated page value (ADR 0005):
   * the primary, when the request is in another language. Empty for the
   * primary itself — its pack, already in the right language, is a better
   * fallback than another language's text.
   */
  fallbackLocales: readonly string[];
  isRTL: boolean;
  /** The SDK client for this request's language — every page read goes through it. */
  client: StoreClient;
  /** The store's languages as URLs need them. */
  routing: LocaleRouting;
  /** This page's path without its language prefix — what the page route matched. */
  pathname: string;
  /** An internal link in this request's language: `href("/products")` → `/fr/products`. */
  href: (path: string) => string;
}

/** What the SDK resolves a request with: this theme's one client factory, and the store it renders when the config cannot be read. */
const STORE = { client: getStoreClient, fallback: DEFAULT_CONFIG };

/**
 * What a request resolves to: a page in one language — with the route to
 * render instead of the request's when its path carried a language prefix —
 * or a redirect, permanent for the primary's prefix, temporary for a language
 * the store stopped publishing. The rules are the SDK's
 * (`resolveStoreRequest`): a page takes its language from its path; a server
 * island or an `/api/*` endpoint from the page that asked for it, and is
 * never redirected or rewritten.
 */
export type StoreRequest =
  | { kind: "page"; store: StoreContext; rewrite: string | null }
  | { kind: "redirect"; location: string; status: 301 | 302 };

export async function resolveStoreRequest(url: URL, referer: string | null): Promise<StoreRequest> {
  const request = await resolveRequest({ url, referer }, STORE);
  return request.kind === "redirect" ? request : { kind: "page", store: storeContext(request), rewrite: request.rewrite };
}

/**
 * The store context of a preview: the language the draft asks for when the
 * store serves it (else the primary), and the store as the draft would leave
 * it — its theme settings and text edits over the saved ones. Only the
 * middleware calls this, for the preview route.
 */
export async function resolvePreviewStore(draft: PreviewDraft): Promise<StoreContext> {
  return storeContext(await resolvePreview(draft, STORE));
}

function storeContext({ config, client, routing, locale, pathname }: ResolvedStore): StoreContext {
  // Only this language's overrides: another language's map would mix languages.
  const content = resolveContent(locale, config.contentOverrides[locale]);
  // The server describes every language it serves; a config that somehow
  // lacks this one renders left-to-right rather than failing the page.
  const isRTL = servedLanguage(config, locale)?.direction === "rtl";
  return {
    config,
    content,
    locale,
    fallbackLocales: locale === routing.primary ? [] : [routing.primary],
    isRTL,
    client,
    routing,
    pathname,
    href: (target) => localizeHref(target, locale, routing),
  };
}
