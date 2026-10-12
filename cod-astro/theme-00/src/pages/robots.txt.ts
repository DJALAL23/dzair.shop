// robots.txt, served rather than static so it can name the sitemap by its
// absolute URL on whatever domain the store runs.
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
