/**
 * The storefront's same-origin API routes — the SDK's, bound to this theme.
 *
 * Each file under `src/pages/api/` exports one of these. What a route checks,
 * forwards and answers (the cross-origin check, the shopper's address, the
 * input bounds, the status a refusal gets) is the SDK's decision, made once
 * for every theme; this theme decides only that a request is served by its
 * own client, in the language of the page that asked (`locals.store`).
 */
import type { APIContext } from "astro";
import { createStorefrontRoutes } from "@wocart/storefront/astro";

export const routes = createStorefrontRoutes<APIContext>({
  client: (context) => context.locals.store.client,
});
