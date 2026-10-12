/**
 * Theme-00's Home catalog (Phase 5, slice 15) — the assembler.
 *
 * Definitions are code; page data is JSON (`src/theme/pages/home.page.json`).
 * Every definition wraps the EXISTING component — no component was rewritten
 * for the contract. Each definition lives under `src/theme/catalog/home/`;
 * the shared read keys and the copy bridge live in `src/theme/catalog/shared.ts`.
 */
import { defineTheme } from "@codflow/theme";
import { SURFACE } from "./catalog/labels";
import { hero } from "./catalog/home/hero.def";
import { categoryCards } from "./catalog/home/category-cards.def";
import { bestSellers } from "./catalog/home/best-sellers.def";
import { howItWorks } from "./catalog/home/how-it-works.def";
import { newArrivals } from "./catalog/home/new-arrivals.def";
import { featuresBar } from "./catalog/home/features-bar.def";
import { whatsappCta } from "./catalog/home/whatsapp-cta.def";
import { customerTestimonials } from "./catalog/home/customer-testimonials.def";

export const theme00 = defineTheme({
  key: "theme-00",
  version: "1.0.0",
  // The only surface this catalog serves. Declared (not enforced): page
  // parsing never consults it; the manifest carries it for future tooling.
  // The languages this theme's content packs cover; every editor label must
  // be translated into all of them (`catalog/labels.ts`).
  locales: ["ar", "fr", "en"],
  surfaces: [{ key: "home", label: SURFACE.home }],
  components: {
    hero,
    "category-cards": categoryCards,
    "best-sellers": bestSellers,
    "how-it-works": howItWorks,
    "new-arrivals": newArrivals,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    "customer-testimonials": customerTestimonials,
  },
});
