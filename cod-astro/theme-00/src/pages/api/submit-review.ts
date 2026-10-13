// Review submission. The body is forwarded exactly as the review form wrote
// it — cod-server owns validation, and the pre-migration route had no schema
// and no cross-origin check. Both are deliberate parity choices (S7).
import { createProxyEndpoint } from "@wocart/storefront/astro";
import { getStoreClient } from "@/theme/sdk";

interface SubmitReviewInput {
  orderNumber: string;
  productId: string;
  rating: number;
  title?: string;
  body: string;
}

export const POST = createProxyEndpoint<SubmitReviewInput, { id: string }>({
  method: "POST",
  csrfProtection: false,
  successStatus: 201,
  errorStatus: 400,
  successBody: (data) => ({ success: true, data }),
  client: (input) => getStoreClient().products.reviews.submit(input),
});
