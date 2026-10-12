// Abandoned-checkout tracking. Same-origin proxy; the shopper's attribution
// headers are forwarded so cod-server records the visitor, not this worker.
// 204 on success — tracking is fire-and-forget by contract.
import { createProxyEndpoint } from "@codflow/storefront/astro";
import { AbandonedCheckoutInputSchema } from "@codflow/storefront";
import { getStoreClient } from "@/theme/sdk";

export const POST = createProxyEndpoint({
  method: "POST",
  // The body contract is the SDK's: its bounds mirror cod-server's
  // `upsertSchema`, so the proxy cannot accept something the server refuses
  // (or refuse something it accepts). A hand-copied schema here is exactly how
  // `communeId` and the variant fields drifted before.
  inputSchema: AbandonedCheckoutInputSchema,
  forwardAttribution: true,
  noContent: true,
  client: (input, headers) =>
    getStoreClient().orders.abandoned.upsert(input, headers),
});
