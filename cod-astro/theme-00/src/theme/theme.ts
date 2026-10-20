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
import { AREA, SURFACE } from "./catalog/labels";
import { ar } from "./content/ar";
import { en } from "./content/en";
import { fr } from "./content/fr";
import homeDocument from "./pages/home.page.json";
import productDocument from "./pages/product.page.json";
import headerDocument from "./pages/header.area.json";
import footerDocument from "./pages/footer.area.json";
import { THEME_STYLE } from "./appearance";
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
import { marquee } from "./catalog/home/marquee.def";
import { productTab, productTabs } from "./catalog/home/product-tabs.def";
import {
  productCollapsible,
  productCountdown,
  productDescription,
  productGallery,
  productMain,
  productOrder,
  productPolicies,
  productPrice,
  productRating,
  productSignals,
  productText,
  productTitle,
} from "./catalog/product/product-main.def";
import { productReviews, relatedProducts } from "./catalog/product/product-sections.def";
import { announcement, announcementBar } from "./catalog/header/announcement-bar.def";
import { header } from "./catalog/header/header.def";
import { footer, footerAbout, footerMenu, footerPages, footerText } from "./catalog/footer/footer.def";

export const theme00 = defineTheme({
  key: THEME_KEY,
  version: "2.0.0",
  preview: true,
  // The languages this theme's content packs cover; every editor label must
  // be translated into all of them (`catalog/labels.ts`).
  locales: ["ar", "fr", "en"],
  // The theme's own text, per language: what every content-keyed field shows
  // until the merchant edits it. Declared here, the SDK checks every
  // contentKey against each pack and the manifest carries them for the editor.
  content: { ar: { ...ar }, fr: { ...fr }, en: { ...en } },
  // The composed pages, each with the document it renders before the store
  // saves one. A template (product, collection, category, text page) renders
  // every resource of its type; a product page always holds its product and
  // the order form inside it.
  surfaces: [
    { key: "home", label: SURFACE.home, pageType: "home", document: homeDocument as PageData },
    {
      key: "product",
      label: SURFACE.product,
      pageType: "product",
      document: productDocument as PageData,
      required: [{ type: "product-main", min: 1, max: 1 }],
    },
    { key: "collection", label: SURFACE.collection, pageType: "collection" },
    { key: "category", label: SURFACE.category, pageType: "category" },
    { key: "catalog", label: SURFACE.catalog, pageType: "catalog" },
    { key: "page", label: SURFACE.page, pageType: "page" },
  ],
  // The parts every page shares, composed of sections and edited once.
  areas: [
    { key: "header", label: AREA.header, document: headerDocument as PageData, required: [{ type: "header", max: 1 }], max: 4 },
    { key: "footer", label: AREA.footer, document: footerDocument as PageData, max: 6 },
  ],
  settings: THEME_SETTINGS,
  // The sizes behind the style steps and widths a merchant picks.
  style: THEME_STYLE,
  components: {
    "product-main": productMain,
    "product-gallery": productGallery,
    "product-title": productTitle,
    "product-rating": productRating,
    "product-price": productPrice,
    "product-signals": productSignals,
    "product-order": productOrder,
    "product-countdown": productCountdown,
    "product-description": productDescription,
    "product-collapsible": productCollapsible,
    "product-policies": productPolicies,
    "product-text": productText,
    "product-reviews": productReviews,
    "related-products": relatedProducts,
    marquee,
    "product-tabs": productTabs,
    "product-tab": productTab,
    "announcement-bar": announcementBar,
    announcement,
    header,
    footer,
    "footer-about": footerAbout,
    "footer-menu": footerMenu,
    "footer-pages": footerPages,
    "footer-text": footerText,
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
