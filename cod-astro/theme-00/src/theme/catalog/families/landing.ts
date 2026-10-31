/**
 * The landing pages: the surface every landing page's own document
 * (`lp:<id>`) follows, its sections, and the content sections an editor may
 * place on a landing page. The landing route imports only this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import landingDocument from "../../pages/landing.page.json";
import { landingImages, landingOrder, landingProduct } from "../landing/landing.def";
import { productReviews } from "../product/product-sections.def";
import { offerCountdown } from "../home/offer-countdown.def";
import { howItWorks } from "../home/how-it-works.def";
import { richText } from "../home/rich-text.def";
import { imageBanner } from "../home/image-banner.def";
import { faq } from "../home/faq.def";
import { customerTestimonials } from "../home/customer-testimonials.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";
import { marquee } from "../home/marquee.def";

export const landingSurface: SurfaceSpec = {
  key: "landing",
  label: SURFACE.landing,
  pageType: "landing",
  document: landingDocument as PageData,
  required: [{ type: "landing-order", min: 1, max: 1 }],
  max: 16,
  hideableAreas: ["header", "footer"],
};

export const landingCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [landingSurface],
  components: {
    "landing-images": landingImages,
    "landing-order": landingOrder,
    "landing-product": landingProduct,
    "product-reviews": productReviews,
    "offer-countdown": offerCountdown,
    "how-it-works": howItWorks,
    "rich-text": richText,
    "image-banner": imageBanner,
    faq,
    "customer-testimonials": customerTestimonials,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    marquee,
  },
});
