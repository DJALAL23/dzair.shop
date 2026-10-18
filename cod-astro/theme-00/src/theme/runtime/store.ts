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
import { getStoreClient, previewConfig, type PreviewDraft, type StoreClient } from "@/theme/sdk";
import { resolveContent } from "@/theme/content";
import {
  localeRouting,
  localizeHref,
  resolveLocalePath,
  servedLanguage,
  type LocaleRouting,
  type StoreConfig,
} from "@wocart/storefront";
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

/**
 * The path a request takes its language from. A page takes it from its own
 * path. A server island (`/_server-islands/…`) or an endpoint (`/api/…`)
 * serves part of a page in a separate request with no language in its URL,
 * so it takes the language of the page that asked for it — the browser sends
 * that page as a same-origin `Referer`. Without one it is served in the
 * primary. Such a request is `embedded`: never redirected, never rewritten.
 */
export function languageSource(url: URL, referer: string | null): { path: string; embedded: boolean } {
  if (!url.pathname.startsWith("/_server-islands/") && !url.pathname.startsWith("/api/")) {
    return { path: url.pathname, embedded: false };
  }
  if (referer === null) return { path: "/", embedded: true };
  try {
    const page = new URL(referer);
    return { path: page.origin === url.origin ? page.pathname : "/", embedded: true };
  } catch {
    return { path: "/", embedded: true };
  }
}

/**
 * What a request resolves to: a page in one language, or a redirect —
 * permanent for the primary's prefix (it has one address), temporary for a
 * language the store stopped publishing (it may publish it again).
 */
export type StoreRequest =
  | { kind: "page"; store: StoreContext }
  | { kind: "redirect"; location: string; status: 301 | 302 };

/**
 * Resolve a request's language from its path and build its store context.
 * The primary config decides which languages exist; the request's own client
 * then serves the config in that language. If the server no longer publishes
 * the language (a stale cached list), the shopper is sent to the primary URL
 * rather than shown a page that claims a language it does not carry.
 */
export async function resolveStoreRequest(requestPath: string): Promise<StoreRequest> {
  // One client per request (see theme/sdk.ts); the primary language reuses it.
  const primaryClient = getStoreClient();
  const primaryConfig = (await primaryClient.config.get()) ?? DEFAULT_CONFIG;
  const routing = localeRouting(primaryConfig);
  const path = resolveLocalePath(requestPath, routing);
  if (path.kind === "redirect") return { kind: "redirect", location: path.location, status: 301 };

  const translated = path.locale !== routing.primary;
  const client = translated ? getStoreClient(path.locale) : primaryClient;
  const config = translated ? (await client.config.get()) ?? primaryConfig : primaryConfig;
  if (translated && config.locale !== path.locale) {
    return { kind: "redirect", location: path.pathname, status: 302 };
  }

  return { kind: "page", store: storeContext(config, client, routing, path.locale, path.pathname) };
}

/**
 * The store context of a preview: the language the draft asks for when the
 * store serves it (else the primary), and the store as the draft would leave
 * it — its theme settings and text edits over the saved ones. Only the
 * middleware calls this, for the preview route.
 */
export async function resolvePreviewStore(draft: PreviewDraft): Promise<StoreContext> {
  const primaryClient = getStoreClient();
  const primaryConfig = (await primaryClient.config.get()) ?? DEFAULT_CONFIG;
  const routing = localeRouting(primaryConfig);
  const pathname = draft.path ?? "/";
  const asked = draft.locale;
  if (asked !== undefined && asked !== routing.primary && routing.published.includes(asked)) {
    const client = getStoreClient(asked);
    const config = await client.config.get();
    if (config !== null && config.locale === asked) return storeContext(previewConfig(config, draft), client, routing, asked, pathname);
  }
  return storeContext(previewConfig(primaryConfig, draft), primaryClient, routing, routing.primary, pathname);
}

function storeContext(config: StoreConfig, client: StoreClient, routing: LocaleRouting, locale: string, pathname: string): StoreContext {
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
