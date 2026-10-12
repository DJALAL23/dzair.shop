// Same-origin proxy for cart validation. The basket line input schema comes
// from the SDK (single source of truth), so bounds here can never drift from
// what POST /store/cart/validate accepts.
import { createProxyEndpoint } from "@codflow/storefront/astro";
import { BasketLineInputSchema, MAX_BASKET_LINES } from "@codflow/storefront";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

const inputSchema = z.object({
  items: z.array(BasketLineInputSchema).min(1).max(MAX_BASKET_LINES),
});

export const POST = createProxyEndpoint({
  method: "POST",
  inputSchema,
  // The cart drawer reads {success, data}; failure keeps the drawer's
  // optimistic view. Wrapped explicitly — never assume the client result is
  // already the HTTP response.
  successBody: (data) => ({ success: true, data }),
  client: ({ items }) => getStoreClient().cart.validate(items),
});
