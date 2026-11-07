/**
 * Theme-00's catalog — the assembler.
 *
 * Definitions are code (`catalog/**`, one `*.def.ts` per section and its
 * blocks); page data is JSON (`pages/*.page.json` for the composed pages,
 * `pages/*.area.json` for the header and footer). Each route renders from its
 * own catalog in `catalog/families/`, so a page carries only the sections it
 * can show. This full catalog is what the theme manifest and the editor's
 * preview read.
 */
import { defineTheme } from "@wocart/theme";
import { ar } from "./content/ar";
import { en } from "./content/en";
import { CONTENT_GROUPS } from "./content/groups";
import { fr } from "./content/fr";
import { THEME_STYLE } from "./appearance";
import { THEME_KEY } from "./key";
import { THEME_SETTINGS } from "./settings";
import { THEME_VERSION } from "./version";
import { homeSurface } from "./catalog/families/home";
import { productSurface } from "./catalog/families/product";
import { catalogSurface, categorySurface, collectionSurface } from "./catalog/families/listing";
import { pageSurface } from "./catalog/families/page";
import { thankYouSurface } from "./catalog/families/thank-you";
import { landingSurface } from "./catalog/families/landing";
import { searchSurface } from "./catalog/families/search";
import { trackOrderSurface } from "./catalog/families/track-order";
import { checkoutSurface } from "./catalog/families/checkout";
import { contactSurface } from "./catalog/families/contact";
import { searchMain } from "./catalog/search/search-main.def";
import { trackOrderMain } from "./catalog/track-order/track-order-main.def";
import { checkoutMain } from "./catalog/checkout/checkout-main.def";
import { contactMain } from "./catalog/contact/contact-main.def";
import { landingImages, landingOrder, landingProduct } from "./catalog/landing/landing.def";
import { offerCountdown } from "./catalog/home/offer-countdown.def";
import { thankYouMain } from "./catalog/thank-you/thank-you-main.def";
import { shellCatalog } from "./catalog/families/shell";
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
import { listingMain } from "./catalog/listing/listing-main.def";
import { pageMain } from "./catalog/listing/page-main.def";
import { announcement, announcementBar } from "./catalog/header/announcement-bar.def";
import { header } from "./catalog/header/header.def";
import { footer, footerAbout, footerMenu, footerPages, footerText } from "./catalog/footer/footer.def";

export const theme00 = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  preview: true,
  // The languages this theme's content packs cover; every editor label must
  // be translated into all of them (`catalog/labels.ts`).
  locales: ["ar", "fr", "en"],
  // The theme's own text, per language: what every content-keyed field shows
  // until the merchant edits it. Declared here, the SDK checks every
  // contentKey against each pack and the manifest carries them for the editor.
  content: { ar: { ...ar }, fr: { ...fr }, en: { ...en } },
  // How the editor groups those words: one group per area of the store.
  contentGroups: CONTENT_GROUPS,
  // The composed pages, each with the document it renders before the store
  // saves one (each page's own catalog declares it).
  surfaces: [homeSurface, productSurface, collectionSurface, categorySurface, catalogSurface, pageSurface, thankYouSurface, landingSurface, searchSurface, trackOrderSurface, checkoutSurface, contactSurface],
  // The parts every page shares, composed of sections and edited once.
  areas: shellCatalog.areas,
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
    "listing-main": listingMain,
    "page-main": pageMain,
    "thank-you-main": thankYouMain,
    "search-main": searchMain,
    "track-order-main": trackOrderMain,
    "checkout-main": checkoutMain,
    "contact-main": contactMain,
    "landing-images": landingImages,
    "landing-order": landingOrder,
    "landing-product": landingProduct,
    "offer-countdown": offerCountdown,
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
