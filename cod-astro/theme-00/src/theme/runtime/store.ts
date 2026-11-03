/**
 * Per-request store data helpers.
 * Call once per page — pass the returned config to StoreLayout to avoid
 * duplicate API fetches.
 *
 * The config comes from the SDK client behind the theme adapter, so a
 * successful read is cached for the client's lifetime (one fetch per isolate,
 * not one per render) and any failure falls back to UNAVAILABLE_STORE. The
 * read itself goes through the theme adapter (`src/theme/sdk.ts`) — the one
 * place an SDK client is created.
 */
import { getStoreClient, storeServerUrl, type StoreClient } from "@/theme/sdk";
import { keepStoreMedia } from "@/theme/utils/image-service";
import { resolveContent } from "@/theme/content";
import { localizeHref, servedLanguage, unavailableStoreConfig, type LocaleRouting, type StoreConfig } from "@wocart/storefront";
import type { ResolvedStore } from "@wocart/storefront/astro";
import type { StoreFrontContent } from "@/theme/content";

/** The store a page renders when its config cannot be read: the SDK's, in this theme's default language. */
export const UNAVAILABLE_STORE: StoreConfig = unavailableStoreConfig({ serverUrl: storeServerUrl(), locale: "ar" });

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
export const STORE = { client: getStoreClient, fallback: UNAVAILABLE_STORE };

/**
 * The store context of a request the SDK resolved (`createStorefrontMiddleware`
 * in `src/middleware.ts`): its language — a page's from its path, a server
 * island's or an `/api/*` endpoint's from the page that asked — its client,
 * and this theme's words and links in that language. A preview's store is the
 * draft's, resolved the same way.
 */
export function storeContext({ config, client, routing, locale, pathname }: ResolvedStore): StoreContext {
  if (config.id !== UNAVAILABLE_STORE.id) keepStoreMedia(config.media);
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
