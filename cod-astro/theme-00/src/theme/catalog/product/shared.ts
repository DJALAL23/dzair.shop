/**
 * What the product page's sections share: the product the route names, read
 * once per render — the route reads it first (a missing product is a 404),
 * and every section and block takes it from the same read.
 */
import type { LoadContext } from "@wocart/theme";
import type { Product } from "@wocart/storefront";

/** The read key of a product by its handle; the route primes it. */
export const productRead = (handle: string) => `product:${handle}`;

/** The product of this page, from its route's `handle`; `null` when there is none. */
export async function routeProduct({ storefront, reads, context }: Pick<LoadContext, "storefront" | "reads" | "context">): Promise<Product | null> {
  const handle = context.params?.handle ?? "";
  return handle === "" ? null : reads.get(productRead(handle), () => storefront.products.get(handle));
}
