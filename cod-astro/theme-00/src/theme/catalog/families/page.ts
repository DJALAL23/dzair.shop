/**
 * The text pages: the page surface, its section, and the content sections an
 * editor may place on a text page. The text-page route imports only this
 * catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import textPageDocument from "../../pages/page.page.json";
import { pageMain } from "../listing/page-main.def";
import { richText } from "../home/rich-text.def";
import { imageBanner } from "../home/image-banner.def";
import { faq } from "../home/faq.def";
import { customerTestimonials } from "../home/customer-testimonials.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";
import { marquee } from "../home/marquee.def";
import { howItWorks } from "../home/how-it-works.def";
import { offerCountdown } from "../home/offer-countdown.def";

export const pageSurface: SurfaceSpec = {
  key: "page",
  label: SURFACE.page,
  pageType: "page",
  document: textPageDocument as PageData,
  required: [{ type: "page-main", min: 1, max: 1 }],
};

export const pageCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [pageSurface],
  components: {
    "page-main": pageMain,
    "rich-text": richText,
    "image-banner": imageBanner,
    faq,
    "customer-testimonials": customerTestimonials,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    marquee,
    "how-it-works": howItWorks,
    "offer-countdown": offerCountdown,
  },
});
