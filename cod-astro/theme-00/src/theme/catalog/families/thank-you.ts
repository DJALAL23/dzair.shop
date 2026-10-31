/**
 * The thank-you page: the surface, its order confirmation, and the content
 * sections an editor may place after it. The thank-you route imports only
 * this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import thankYouDocument from "../../pages/thank-you.page.json";
import { thankYouMain } from "../thank-you/thank-you-main.def";
import { richText } from "../home/rich-text.def";
import { faq } from "../home/faq.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";
import { marquee } from "../home/marquee.def";

export const thankYouSurface: SurfaceSpec = {
  key: "thank-you",
  label: SURFACE.thankYou,
  pageType: "thankYou",
  document: thankYouDocument as PageData,
  required: [{ type: "thank-you-main", min: 1, max: 1 }],
};

export const thankYouCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [thankYouSurface],
  components: {
    "thank-you-main": thankYouMain,
    "rich-text": richText,
    faq,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    marquee,
  },
});
