import { fileURLToPath } from "node:url";
import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

const orderDetailFallback = {
  name: "order-detail-static-fallback",
  // Vite resolves plugin hooks (including configureServer) in enforce-sorted
  // order: pre plugins install their dev middleware before the Cloudflare
  // runtime proxy, which otherwise handles every request first.
  enforce: "en",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = request.url?.split("?", 1)[0] ?? "";
       const isOrderDetail = /^\/orders\/[^/]+\/?$/.test(pathname) && pathname !== "/orders/new" && pathname !== "/orders/abandoned";
       const isCustomerDetail = /^\/customers\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customers/new";
       const isCustomerGroupDetail = /^\/customer-groups\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customer-groups/new";
       const isCustomerTagDetail = /^\/customer-tags\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/customer-tags/new";
       const isProductDetail = /^\/products\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/products/new" && pathname !== "/products/stock";
       const isProductGroupEdit = /^\/product-groups\/[^/]+\/edit\/?$/.test(pathname);
       const isOfferEdit = /^\/offers\/[^/]+\/?$/.test(pathname) && pathname !== "/offers/new";
       const isDriverRoute = /^\/delivery\/drivers\/[^/]+(?:\/(edit|compensations))?\/?$/.test(pathname) && pathname !== "/delivery/drivers/new";
       const isDeliveryCompanyRoute = /^\/delivery\/companies\/[^/]+(?:\/(credentials|stop-desks))?\/?$/.test(pathname);
       const isShippingProfileRoute = /^\/delivery\/shipping-profiles\/[^/]+(?:\/edit)?\/?$/.test(pathname) && pathname !== "/delivery/shipping-profiles/new";
       const isTeamMemberRoute = /^\/team\/[^/]+\/?$/.test(pathname);
       const isLandingPageStudio = /^\/landing-pages\/[^/]+\/studio\/?$/.test(pathname);
       const isDetail = isOrderDetail || isCustomerDetail || isCustomerGroupDetail || isCustomerTagDetail || isProductDetail || isProductGroupEdit || isOfferEdit || isDriverRoute || isDeliveryCompanyRoute || isShippingProfileRoute || isTeamMemberRoute || isLandingPageStudio;
       // Host-level SPA fallback: mirror production's
       // assets.not_found_handling = "single-page-application" (wrangler.toml)
       // by serving the client index for detail loads. Mutating-and-forwarding
       // cannot work here: the adapter stack restores the request URL after
       // the middleware chain, so we serve the proven root page directly.
       if (!isDetail || request.method !== "GET") return next();
       const base = server.resolvedUrls?.local?.[0];
       if (!base) return next();
       try {
         const upstream = await fetch(base, { headers: { accept: "text/html" } });
         response.statusCode = upstream.status;
         response.setHeader("content-type", upstream.headers.get("content-type") ?? "text/html; charset=utf-8");
         response.end(Buffer.from(await upstream.arrayBuffer()));
       } catch {
         next();
       }
    });
  },
};

// Static-first: every page prerenders at build time except routes that opt out
// with `export const prerender = false` (currently only /api/auth/*).
export default defineConfig({
  output: "static",
  // No Astro.session usage (auth is better-auth + its own KV) — docs:
  // session:false skips SESSION KV provisioning and drops the session
  // runtime from the Worker bundle.
  session: false,
  env: {
    schema: {
      PUBLIC_API_URL: envField.string({ context: "client", access: "public" }),
    },
  },
  integrations: [react()],
  adapter: cloudflare({
    // No astro:assets usage yet — noop image service per adapter docs.
    imageService: "passthrough",
    // Share one local D1/KV state with cod-server (`npm run dev` there uses
    // --persist-to ../.wrangler-shared): without this, astro dev gets its own
    // empty SQLite and sign-in fails against an unmigrated database.
    persistState: { path: "../.wrangler-shared" },
  }),
  vite: {
    // Mirror production's assets.not_found_handling = "single-page-application"
    // (wrangler.toml): Vite's first-class SPA fallback serves the client index
    // for unmatched HTML requests during astro dev only.
    appType: "spa",
    plugins: [orderDetailFallback, tailwindcss()],
    // Pre-bundle the dependencies of every source module at startup, not only
    // the ones Vite's scan reaches from the pages. A component loaded with
    // `lazy(() => import(...))` (the rich-text editors) is otherwise
    // discovered on first use, mid-request: Vite re-bundles, and the editor's
    // in-flight imports point at files that no longer exist (404, the editor
    // never loads). Dev only — the production build bundles everything.
    optimizeDeps: {
      entries: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
      // Astro's own client modules, reached from its generated page scripts
      // rather than from any source file the scan reads.
      include: [
        "astro/virtual-modules/transitions-events.js",
        "astro/virtual-modules/transitions-router.js",
        "astro/virtual-modules/transitions-swap-functions.js",
        "astro/virtual-modules/transitions-types.js",
      ],
    },
    // The server half has the same race on a cold start: these are discovered
    // after the first scan, the worker re-bundles, and the dev server can exit
    // before it is ready — or briefly hold two copies of React, which breaks
    // every hook. Declared up front, they are bundled with the rest. Vite 8
    // reads this under `environments.ssr`; the legacy `vite.ssr.optimizeDeps`
    // key is ignored with the Cloudflare adapter (Theme-00 hit the same).
    environments: {
      ssr: {
        optimizeDeps: {
          include: [
            "astro/assets/services/noop",
            "astro/logger/console",
            "drizzle-orm/d1",
            "better-auth",
            "better-auth/plugins",
            "better-auth-cloudflare",
          ],
        },
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
