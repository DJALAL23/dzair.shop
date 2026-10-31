/**
 * What the product page's and landing pages' sections share: the resource
 * the route names, read once per render — the route reads it first (a
 * missing product is a 404; a missing landing page goes home), and every
 * section and block takes it from the same read.
 */
import type { LoadContext } from "@wocart/theme";
import type { LandingPage, Product } from "@wocart/storefront";

type Route = Pick<LoadContext, "storefront" | "reads" | "context">;

/** The read key of a product by its handle; the route primes it. */
export const productRead = (handle: string) => `product:${handle}`;

/** The read key of a landing page by its slug; the landing route and the preview prime it. */
export const landingRead = (slug: string) => `landing:${slug}`;

/** The landing page a landing route names (`surface` "landing", `slug`); `null` on any other page. */
export async function routeLanding({ storefront, reads, context }: Route): Promise<LandingPage | null> {
  const slug = context.params?.slug ?? "";
  return context.params?.surface === "landing" && slug !== "" ? reads.get(landingRead(slug), () => storefront.pages.landing(slug)) : null;
}

/** The product of this page: the product page's `handle`, or the one its landing page sells; `null` when there is none. */
export async function routeProduct(route: Route): Promise<Product | null> {
  const handle = route.context.params?.handle ?? "";
  if (handle !== "") return route.reads.get(productRead(handle), () => route.storefront.products.get(handle));
  return (await routeLanding(route))?.product ?? null;
}
