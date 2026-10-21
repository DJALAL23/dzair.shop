import { defineConfig, envField, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import icon from "astro-icon";
import themeFonts from "./src/theme/fonts.json" with { type: "json" };

const isVercel = process.env.DEPLOY_TARGET === "vercel";
// Images: both builds use the theme's own image service
// (src/theme/utils/image-service.ts) — every media-domain <Image> is resized
// by Cloudflare on the media domain itself, so a storefront on Vercel gets
// the same resizing and edge cache as one on Cloudflare. "custom" keeps it on
// Cloudflare; the Vercel adapter keeps it while its own imageService is off.
const adapter = isVercel
  ? (await import("@astrojs/vercel")).default()
  : (await import("@astrojs/cloudflare")).default({ imageService: "custom" });

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
  // Every cached page carries "pages": a publish (theme pages, settings or
  // text) changes them all, and src/pages/wocart-revalidate.ts drops that tag.
  routeRules: {
    "/": { maxAge: 60, swr: 3600, tags: ["home", "pages"] },
    "/products": { maxAge: 60, swr: 3600, tags: ["products", "pages"] },
    "/products/[slug]": { maxAge: 60, swr: 86400, tags: ["products", "pages"] },
    "/category/[slug]": { maxAge: 60, swr: 86400, tags: ["categories", "pages"] },
    "/lp/[slug]": { maxAge: 60, swr: 86400, tags: ["landing-pages", "pages"] },
    "/pages/[slug]": { maxAge: 3600, swr: 604800, tags: ["legal-pages", "pages"] },
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
      // Optional editor preview public key (an Ed25519 JWK). Unset → the
      // preview route answers 404; a storefront verifies tokens, never makes them.
      WOCART_PREVIEW_KEY: envField.string({
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
    service: { entrypoint: "./src/theme/utils/image-service.ts" },
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
    // Astro's default: stylesheets under 4 kB are inlined, larger ones are
    // linked, so the page's CSS is cached and shared across every page.
    inlineStylesheets: "auto",
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
          "chevron-left",      // announcement bar: previous message
          "chevron-right",     // announcement bar: next message
          "sparkles-solid",    // scrolling text: between messages
          "arrow-up-left",     // category tiles: "discover all" (RTL flips it)
          "shield-check",      // order form: no prepayment
          "arrow-path",        // order form: exchange policy
          "map-pin",           // order form: address
          "user",              // order form: name
          "fire",              // product page: stock running low
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
          "play-solid",        // review voice note: play
          "pause-solid",       // review voice note: pause
          "paper-clip",        // review form: send an audio file
          "camera",            // review form: add photos
        ],
      },
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
    },
  },
});
