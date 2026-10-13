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
 * - **A fresh client for every call, so for every request.** The SDK client
 *   caches pending reads and merges a read with one already in flight for the
 *   same URL. Within one request that saves calls; across requests it is a
 *   hang: a request that waits on a read another request started never
 *   settles once that other request is cancelled (a shopper leaving mid-load,
 *   a click interrupting a page fetch), and every later request for the same
 *   URL waits behind it. A request's own client lives and dies with it.
 *
 * A defect in SDK behavior is fixed in `wocart-sdk/storefront/` with a regression
 * test there — never by growing this file into a second implementation.
 */
import { createStoreClient, type StoreClient } from "@wocart/storefront/server";

export type { StoreClient };
import { COD_SERVER_URL, STORE_API_KEY } from "astro:env/server";
import { THEME_KEY } from "@/theme/key";

/**
 * The client for one language. `locale` is omitted for the store's primary
 * language — merchant text comes back as written — and set for any other, so
 * cod-server serves its translations (ADR 0005). Pages never call this:
 * they read `Astro.locals.store.client`, the request's own.
 */
export function getStoreClient(locale?: string): StoreClient {
  const apiKey = STORE_API_KEY;
  const serverUrl = COD_SERVER_URL ?? "http://localhost:8787";
  return createStoreClient({
      serverUrl,
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
