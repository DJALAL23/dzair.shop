// The sitemap: every storefront page in every published language. Landing
// pages are left out — they are ad destinations, often unlisted from the store.
import type { APIRoute } from "astro";
import { sitemapXml } from "@/theme/utils/sitemap";

export const prerender = false;

/** The server's page cap: the catalog is read in pages of this size. */
const PAGE_SIZE = 100;

export const GET: APIRoute = async ({ locals, url }) => {
  const { client, config, routing } = locals.store;
  const [categories, products] = await Promise.all([client.categories.list(), allProducts(client)]);
  const paths = [
    "/",
    "/products",
    ...categories.map((category) => `/category/${category.slug}`),
    ...products.map((product) => `/products/${product.handle}`),
    ...config.pages.map((page) => `/pages/${page.slug}`),
  ];
  return new Response(sitemapXml(paths, routing, url.origin), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};

async function allProducts(client: App.Locals["store"]["client"]) {
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await client.products.list({ limit: PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}
