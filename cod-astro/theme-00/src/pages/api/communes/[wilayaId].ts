// Communes for the order form's wilaya → commune chain. Same-origin proxy:
// the browser sends no credentials, the store key stays server-side. A thin
// binding over the SDK's proxy-endpoint factory (S7) — no local forwarding,
// envelope, or CSRF logic lives here any more.
import { createProxyEndpoint, type ProxyClientFn } from "@wocart/storefront/astro";
import { WilayaIdSchema, type Commune } from "@wocart/storefront";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

// The id bound is the SDK's (`WILAYAS` decides the ceiling), so the route's
// early 400 and cod-server's accepted range move together.
const inputSchema = z.object({ wilayaId: WilayaIdSchema });

const fetchCommunes: ProxyClientFn<z.infer<typeof inputSchema>, Commune[]> = async ({
  wilayaId,
}) => ({
  success: true,
  data: await getStoreClient().geo.communes(wilayaId),
});

export const GET = createProxyEndpoint({
  method: "GET",
  pathParams: { wilayaId: "number" },
  inputSchema,
  client: fetchCommunes,
});
