/**
 * The home page: its surface and the sections an editor may place on it. The
 * home route imports only this catalog, so the home page carries only what it
 * can show.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import homeDocument from "../../pages/home.page.json";
import { hero } from "../home/hero.def";
import { categoryCards } from "../home/category-cards.def";
import { bestSellers } from "../home/best-sellers.def";
import { howItWorks } from "../home/how-it-works.def";
import { offerCountdown } from "../home/offer-countdown.def";
import { newArrivals } from "../home/new-arrivals.def";
import { featuredProducts } from "../home/featured-products.def";
import { onSale } from "../home/on-sale.def";
import { featuredProduct } from "../home/featured-product.def";
import { productTab, productTabs } from "../home/product-tabs.def";
import { marquee } from "../home/marquee.def";
import { richText } from "../home/rich-text.def";
import { imageBanner } from "../home/image-banner.def";
import { faq } from "../home/faq.def";
import { customerTestimonials } from "../home/customer-testimonials.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";

export const homeSurface: SurfaceSpec = {
  key: "home",
  label: SURFACE.home,
  pageType: "home",
  document: homeDocument as PageData,
};

export const homeCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [homeSurface],
  components: {
    hero,
    "category-cards": categoryCards,
    "best-sellers": bestSellers,
    "how-it-works": howItWorks,
    "offer-countdown": offerCountdown,
    "new-arrivals": newArrivals,
    "featured-products": featuredProducts,
    "on-sale": onSale,
    "featured-product": featuredProduct,
    "product-tabs": productTabs,
    "product-tab": productTab,
    marquee,
    "rich-text": richText,
    "image-banner": imageBanner,
    faq,
    "customer-testimonials": customerTestimonials,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
  },
});
