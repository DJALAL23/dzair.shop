// Same-origin proxy for cart validation. The basket line input schema comes
// from the SDK (single source of truth), so bounds here can never drift from
// what POST /store/cart/validate accepts. The request's client is in the
// language of the page that asked, so the lines come back named in it.
import type { APIRoute } from "astro";
import { createProxyEndpoint } from "@codflow/storefront/astro";
import { BasketLineInputSchema, MAX_BASKET_LINES } from "@codflow/storefront";
import { z } from "astro/zod";

const inputSchema = z.object({
  items: z.array(BasketLineInputSchema).min(1).max(MAX_BASKET_LINES),
});

export const POST: APIRoute = (context) => createProxyEndpoint({
  method: "POST",
  inputSchema,
  // The cart drawer reads {success, data}; failure keeps the drawer's
  // optimistic view. Wrapped explicitly — never assume the client result is
  // already the HTTP response.
  successBody: (data) => ({ success: true, data }),
  client: ({ items }) => context.locals.store.client.cart.validate(items),
})(context);
