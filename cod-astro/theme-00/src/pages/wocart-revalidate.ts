// The platform's revalidation route (REVALIDATE_PATH): after a merchant
// publishes, CodFlow Cloud posts a signed token here and the theme drops every
// cached page, so the publish shows at once on Cloudflare and Vercel alike.
// Every cached page route carries PAGES_CACHE_TAG (astro.config.mjs).
import { revalidateRoute } from "@/theme/sdk";

export const prerender = false;

export const { POST, ALL } = revalidateRoute;
