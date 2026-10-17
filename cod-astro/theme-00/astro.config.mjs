import { defineConfig, envField, fontProviders, passthroughImageService } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import compress from "@playform/compress";
import icon from "astro-icon";
import themeFonts from "./src/theme/fonts.json" with { type: "json" };

const isVercel = process.env.DEPLOY_TARGET === "vercel";
const adapter = isVercel
  ? (await import("@astrojs/vercel")).default()
  : (await import("@astrojs/cloudflare")).default({
      // Cloudflare Image Resizing: every <Image> becomes a /cdn-cgi/image/…
      // URL on the store's own domain, resized and re-encoded at the edge.
      // The adapter adds onerror=redirect, so a failed resize serves the
      // original. Requires Images → Transformations on the store's zone.
      // `astro dev` keeps passthrough, so local images still load.
      imageService: "cloudflare",
    });

const cacheProvider = isVercel
  ? (await import("@astrojs/vercel/cache")).cacheVercel()
  : (await import("@astrojs/cloudflare/cache")).cacheCloudflare();

// `astro dev` keeps its own dependency cache. `astro check` and `astro build`
// run Vite against this same project and rewrite a shared cache with their own,
// smaller scan — under a running dev server that leaves every open page
// importing deleted files (404s, islands that never hydrate, a blank page).
const devServer = process.argv.includes("dev");

export default defineConfig({
  output: "server",
  compressHTML: true,
  session: false,
  adapter,
  cache: {
    provider: cacheProvider,
  },
  routeRules: {
    "/": { maxAge: 60, swr: 3600, tags: ["home"] },
    "/products": { maxAge: 60, swr: 3600, tags: ["products"] },
    "/products/[slug]": { maxAge: 60, swr: 86400, tags: ["products"] },
    "/category/[slug]": { maxAge: 60, swr: 86400, tags: ["categories"] },
    "/lp/[slug]": { maxAge: 60, swr: 86400, tags: ["landing-pages"] },
    "/pages/[slug]": { maxAge: 3600, swr: 604800, tags: ["legal-pages"] },
    "/api/communes/[wilayaId]": { maxAge: 31536000, swr: 31536000, tags: ["communes"] },
  },
  env: {
    schema: {
      STORE_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true, // Allow build to proceed with warning if missing
      }),
      COD_SERVER_URL: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      // Optional media/CDN domain serving R2 images (e.g. media.yourdomain.com).
      // Unset → the image optimizer passes original URLs through unchanged.
      MEDIA_DOMAIN: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },
  // Links prefetch only when they opt in with data-astro-prefetch, as before
  // ClientRouter; its default would prefetch every link on the page.
  prefetch: { prefetchAll: false },
  image: {
    ...(isVercel ? { service: passthroughImageService() } : {}),
    remotePatterns: [{ protocol: "https" }],
  },
  // Every font a store can use is declared here and self-hosted at build time:
  // Astro downloads the files from Google once, serves them from the store's own
  // domain, and the browser fetches a face only when text uses it. The list lives
  // in fonts.json, which the theme reads too, so the two cannot drift.
  fonts: themeFonts.map((font) => ({
    name: font.family,
    cssVariable: font.cssVariable,
    provider: fontProviders.google(),
    weights: font.weights,
    styles: ["normal"],
    subsets: ["arabic", "latin"],
    fallbacks: ["system-ui", "sans-serif"],
  })),
  build: {
    // Inline ALL stylesheets to eliminate render-blocking CSS
    inlineStylesheets: "always",
  },
  integrations: [
    icon({
      include: {
        heroicons: [
          "check-badge",       // features: Authentic Products, verified buyer
          "truck",             // features: Fast Delivery, announcement bar
          "banknotes",         // features: COD, HowItWorks step 3
          "clock",             // features: 24/7 Support
          "arrow-right",       // CTA arrows
          "magnifying-glass",  // search
          "bars-3",            // phone menu toggle
          "shopping-bag",      // HowItWorks, product card order btn
          "chat-bubble-left-right", // HowItWorks step 2
          "check",             // selected state checkmarks
          "chevron-down",      // dropdown toggle
          "photo",             // image placeholder
          "home",              // mobile nav
          "squares-2x2",       // mobile nav products
          "check-circle",      // review success, verified buyer
          "credit-card",       // trust: COD payment
          "bolt",              // trust: fast / low stock
          "phone",             // thank-you step 1
          "cube",              // thank-you step 2 (package)
          "gift",              // offer free label
          "tag",               // coupon code box
          "exclamation-triangle", // warning/error
          "chat-bubble-left",  // WhatsApp CTA
          "chat-bubble-left-ellipsis", // OTP step
          "star",              // reviews header
          "star-solid",        // filled rating stars
          "home-modern",       // delivery: home
          "x-mark",            // cart drawer close button
          "minus",             // cart line quantity decrease
          "plus",              // cart line quantity increase
          "trash",             // cart line remove button
          "language",          // header language switcher
          "microphone",        // review form: record a voice note
          "stop",              // review form: stop recording
          "paper-clip",        // review form: send an audio file
          "camera",            // review form: add photos
        ],
      },
    }),
    compress({
      CSS: true,
      HTML: {
        removeAttributeQuotes: false,
        removeComments: true,
        collapseWhitespace: true,
      },
      Image: true,
      JavaScript: true,
      SVG: true,
    }),
  ],
  vite: {
    cacheDir: devServer ? "node_modules/.vite-dev" : undefined,
    plugins: [tailwindcss()],
    environments: {
      ssr: {
        optimizeDeps: {
          // Deps discovered after boot trigger a re-bundle whose chunk renames
          // race the workerd reload and wedge/crash the runner
          // (withastro/astro#16933). Disable late discovery entirely: deps
          // found at request time load unbundled instead. Must live under
          // vite.environments.ssr — the legacy vite.ssr.optimizeDeps key is
          // ignored by Vite 8 here.
          noDiscovery: true,
          // The adapter's worker entry is excluded too: pre-bundled, a later
          // re-bundle (Tailwind regenerating CSS after an edit is enough)
          // leaves the runner asking for the entry under a stale version
          // hash, and every request 500s until the dev server restarts.
          exclude: [
            "astro/assets/services/noop",
            "astro-icon/components",
            "@astrojs/cloudflare/entrypoints/server",
          ],
        },
      },
    },
    build: {
      // Minify for production
      minify: "esbuild",
      cssMinify: true,
      // Inline assets up to 100KB (way more than our 8.51KB CSS)
      assetsInlineLimit: 102400,
      // Disable CSS code splitting to keep all CSS together
      cssCodeSplit: false,
    },
  },
});
