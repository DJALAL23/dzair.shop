// The platform's revalidation route (REVALIDATE_PATH): after a merchant
// publishes, CodFlow Cloud posts a signed token here and the theme drops every
// cached page, so the publish shows at once on Cloudflare and Vercel alike.
// Every cached page route carries PAGES_CACHE_TAG (astro.config.mjs).
import type { APIRoute } from "astro";
import { readThemeRevalidation } from "@/theme/sdk";

export const prerender = false;

/** The cache tag every cached page route carries. */
export const PAGES_CACHE_TAG = "pages";

export const POST: APIRoute = async (context) => {
  const revalidation = await readThemeRevalidation(context.request);
  if (!revalidation.ok) return new Response(null, { status: revalidation.status, headers: { "Cache-Control": "no-store" } });
  await context.cache.invalidate({ tags: [PAGES_CACHE_TAG] });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
