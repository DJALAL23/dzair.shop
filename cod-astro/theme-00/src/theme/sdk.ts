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
 *   Browser scripts import `@codflow/storefront` directly for browser-safe
 *   helpers (basket, storage, money) — never this module.
 * - **The API key never leaves the server.** The client it builds holds the
 *   key; nothing exported here is serialized into a page or a script tag.
 * - **Local dev default.** `COD_SERVER_URL` falls back to
 *   `http://localhost:8787` (parity with the legacy client), so an unset
 *   variable cannot silently point the storefront at a wrong origin.
 * - **One client per store scope.** A Worker isolate reuses the client for a
 *   given `(serverUrl, apiKey)`, so the SDK's process-lifetime caches (store
 *   config, categories, communes) actually get reused across requests instead
 *   of refetching per request. A changed scope (e.g. a different store key)
 *   gets its own client — caches are never shared across scopes.
 *
 * A defect in SDK behavior is fixed in `cod-sdk/storefront/` with a regression
 * test there — never by growing this file into a second implementation.
 */
import { createStoreClient, type StoreClient } from "@codflow/storefront/server";
import { COD_SERVER_URL, STORE_API_KEY } from "astro:env/server";
import { THEME_KEY } from "@/theme/key";

const clientsByScope = new Map<string, StoreClient>();

export function getStoreClient(): StoreClient {
  const apiKey = STORE_API_KEY;
  const serverUrl = COD_SERVER_URL ?? "http://localhost:8787";
  const scopeKey = `${serverUrl}\u0000${apiKey}`;

  let client = clientsByScope.get(scopeKey);
  if (!client) {
    client = createStoreClient({
      serverUrl,
      apiKey: apiKey as string,
      // The store's edits to this theme's text come back with the config.
      theme: THEME_KEY,
      // Degraded reads (config, page data, …) are otherwise silent: the SDK's
      // reads never throw, so this is the one place the theme observes them.
      onError: (error) => {
        console.warn(`[theme-00] degraded read: ${error.operation} (${error.code})`);
      },
    });
    clientsByScope.set(scopeKey, client);
  }
  return client;
}
