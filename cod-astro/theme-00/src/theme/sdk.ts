/**
 * S5 — the theme's ONE platform adapter seam.
 *
 * Every SDK client in this theme is created here and nowhere else (PLAN/04
 * Phase 2: "one theme-owned integration seam that creates the SDK client").
 * When something looks wrong with store data, the env wiring, or the API key,
 * this is the file to inspect.
 *
 * Rules this module encodes:
 *
 * - **Server-only.** It reads `astro:env/server`, so it may only be imported
 *   from server code (page frontmatter, actions, middleware, endpoints).
 *   Browser scripts import `@wocart/storefront` directly for browser-safe
 *   helpers (basket, storage, money) — never this module.
 * - **The API key never leaves the server.** The client it builds holds the
 *   key; nothing exported here is serialized into a page or a script tag.
 * - **Local dev default.** `COD_SERVER_URL` falls back to
 *   `http://localhost:8787` (parity with the legacy client), so an unset
 *   variable cannot silently point the storefront at a wrong origin.
 * - **A fresh client for every call, so for every request.** A request's own
 *   client lives and dies with it: nothing one request starts can hold
 *   another, and the store's config is read fresh on every page. (The SDK
 *   itself no longer shares pending reads since @wocart/storefront 1.1.0;
 *   before that, a client kept per isolate hung pages after a cancelled
 *   request.)
 *
 * A defect in SDK behavior is fixed in `@wocart/storefront` with a regression
 * test there — never by growing this file into a second implementation.
 */
import { createStoreClient, type StoreClient } from "@wocart/storefront/server";
import { revalidateEndpoint } from "@wocart/storefront/astro";
import { THEME_PREVIEW_PATH } from "@wocart/theme";

export type { StoreClient };
export { REVALIDATE_PATH, catalogPaths, previewResponseHeaders, sitemapXml } from "@wocart/storefront/server";
export type { PreviewClaims, PreviewDraft } from "@wocart/storefront/server";
import { COD_SERVER_URL, STORE_API_KEY, WOCART_PREVIEW_KEY } from "astro:env/server";
import { THEME_KEY } from "@/theme/key";

/**
 * The client for one language. `locale` is omitted for the store's primary
 * language — merchant text comes back as written — and set for any other, so
 * cod-server serves its translations (ADR 0005). Pages never call this:
 * they read `Astro.locals.store.client`, the request's own.
 */
/** The store's server, as every client of this theme reaches it. */
export const storeServerUrl = (): string => COD_SERVER_URL ?? "http://localhost:8787";

export function getStoreClient(locale?: string): StoreClient {
  const apiKey = STORE_API_KEY;
  return createStoreClient({
      serverUrl: storeServerUrl(),
      apiKey: apiKey as string,
      // The store's edits to this theme's text come back with the config.
      theme: THEME_KEY,
      ...(locale === undefined ? {} : { locale }),
      // Degraded reads (config, page data, …) are otherwise silent: the SDK's
      // reads never throw, so this is the one place the theme observes them.
      onError: (error) => {
        console.warn(`[theme-00] degraded read: ${error.operation} (${error.code})`);
      },
    });
}

/**
 * An editor's preview (`/wocart-preview`), as the SDK's middleware opens it:
 * a token the editor's server signed, for this storefront and this theme,
 * checked with this deployment's preview key. Without a key
 * (`WOCART_PREVIEW_KEY` unset) preview is off and every such request answers
 * 404. The key is read on each request: a secret can be set after this
 * module loads.
 */
export const PREVIEW = { path: THEME_PREVIEW_PATH, publicKey: () => WOCART_PREVIEW_KEY, theme: THEME_KEY };

/**
 * The platform's revalidation route (`/wocart-revalidate`): a publish changed
 * what this store's pages show. Checked with the same deployment key as
 * previews, for a token made for revalidation only; without a key it answers
 * 404.
 */
export const revalidateRoute = revalidateEndpoint({ publicKey: () => WOCART_PREVIEW_KEY, theme: THEME_KEY });
