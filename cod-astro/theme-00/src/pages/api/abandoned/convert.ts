// Marks an abandoned session as converted after a successful order. cod-server
// treats this as fire-and-forget (always 200, unknown sessions succeed
// silently), so a 204 here means "received".
import { createProxyEndpoint } from "@codflow/storefront/astro";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

export const POST = createProxyEndpoint({
  method: "POST",
  inputSchema: z.object({
    sessionId: z.string().uuid(),
    orderId: z.string().min(1).max(200),
    orderNumber: z.string().min(1).max(100),
  }),
  noContent: true,
  client: ({ sessionId, orderId, orderNumber }) =>
    getStoreClient().orders.abandoned.convert(sessionId, orderId, orderNumber),
});
