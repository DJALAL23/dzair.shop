// Reviews for a product (paged). The browser contract is { data, total }: the
// rows array plus the pagination total the load-more button reads.
import { createProxyEndpoint, type ProxyClientFn } from "@wocart/storefront/astro";
import type { Review } from "@wocart/storefront";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

const inputSchema = z.object({
  productId: z.string().min(1),
  limit: z.coerce.number().int().min(0).catch(20).transform((n) => Math.min(n, 50)),
  offset: z.coerce.number().int().min(0).catch(0),
});

const fetchReviews: ProxyClientFn<
  z.infer<typeof inputSchema>,
  { rows: Review[]; total: number }
> = async ({ productId, limit, offset }) => ({
  success: true,
  data: await getStoreClient().products.reviews.list(productId, { limit, offset }),
});

export const GET = createProxyEndpoint({
  method: "GET",
  pathParams: { productId: "string" },
  queryParams: ["limit", "offset"],
  inputSchema,
  successBody: ({ rows, total }) => ({ data: rows, total }),
  client: fetchReviews,
});
