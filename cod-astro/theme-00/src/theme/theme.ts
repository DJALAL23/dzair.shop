/**
 * Theme-00's Home catalog (Phase 5, slice 15) — the assembler.
 *
 * Definitions are code; page data is JSON (`src/theme/pages/home.page.json`).
 * Every definition wraps the EXISTING component — no component was rewritten
 * for the contract. Each definition lives under `src/theme/catalog/home/`;
 * the shared read keys and the copy bridge live in `src/theme/catalog/shared.ts`.
 */
import { defineTheme } from "@wocart/theme";
import type { PageData } from "@wocart/theme";
import { SURFACE } from "./catalog/labels";
import { ar } from "./content/ar";
import { en } from "./content/en";
import { fr } from "./content/fr";
import homeDocument from "./pages/home.page.json";
import { THEME_KEY } from "./key";
import { THEME_SETTINGS } from "./settings";
import { hero } from "./catalog/home/hero.def";
import { categoryCards } from "./catalog/home/category-cards.def";
import { bestSellers } from "./catalog/home/best-sellers.def";
import { howItWorks } from "./catalog/home/how-it-works.def";
import { newArrivals } from "./catalog/home/new-arrivals.def";
import { featuredProducts } from "./catalog/home/featured-products.def";
import { onSale } from "./catalog/home/on-sale.def";
import { featuresBar } from "./catalog/home/features-bar.def";
import { whatsappCta } from "./catalog/home/whatsapp-cta.def";
import { customerTestimonials } from "./catalog/home/customer-testimonials.def";
import { imageBanner } from "./catalog/home/image-banner.def";
import { richText } from "./catalog/home/rich-text.def";
import { faq } from "./catalog/home/faq.def";
import { featuredProduct } from "./catalog/home/featured-product.def";

export const theme00 = defineTheme({
  key: THEME_KEY,
  version: "1.4.0",
  preview: true,
  // The languages this theme's content packs cover; every editor label must
  // be translated into all of them (`catalog/labels.ts`).
  locales: ["ar", "fr", "en"],
  // The theme's own text, per language: what every content-keyed field shows
  // until the merchant edits it. Declared here, the SDK checks every
  // contentKey against each pack and the manifest carries them for the editor.
  content: { ar: { ...ar }, fr: { ...fr }, en: { ...en } },
  // The only composed surface: the home page, with the document it renders
  // before the store saves one (`pages/home.page.json`).
  surfaces: [{ key: "home", label: SURFACE.home, pageType: "home", document: homeDocument as PageData }],
  settings: THEME_SETTINGS,
  components: {
    hero,
    "category-cards": categoryCards,
    "best-sellers": bestSellers,
    "how-it-works": howItWorks,
    "new-arrivals": newArrivals,
    "featured-products": featuredProducts,
    "on-sale": onSale,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    "customer-testimonials": customerTestimonials,
    "image-banner": imageBanner,
    "rich-text": richText,
    faq,
    "featured-product": featuredProduct,
  },
});
