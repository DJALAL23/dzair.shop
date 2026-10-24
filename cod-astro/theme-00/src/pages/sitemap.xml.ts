// The sitemap: every storefront page in every published language. Landing
// pages are left out — they are ad destinations, often unlisted from the store.
import type { APIRoute } from "astro";
import { catalogPaths, sitemapXml } from "@/theme/sdk";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const { client, config, routing } = locals.store;
  return new Response(sitemapXml(await catalogPaths(client, config), routing, url.origin), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};
