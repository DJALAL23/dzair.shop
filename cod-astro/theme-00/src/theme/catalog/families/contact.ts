/**
 * The contact page: the surface, the store's ways to reach it, and the content
 * sections an editor may place around them. The contact route imports only
 * this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import contactDocument from "../../pages/contact.page.json";
import { contactMain } from "../contact/contact-main.def";
import { richText } from "../home/rich-text.def";
import { faq } from "../home/faq.def";
import { imageBanner } from "../home/image-banner.def";
import { featuresBar } from "../home/features-bar.def";
import { marquee } from "../home/marquee.def";

export const contactSurface: SurfaceSpec = {
  key: "contact",
  label: SURFACE.contact,
  pageType: "contact",
  document: contactDocument as PageData,
  required: [{ type: "contact-main", min: 1, max: 1 }],
};

export const contactCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [contactSurface],
  components: {
    "contact-main": contactMain,
    "rich-text": richText,
    faq,
    "image-banner": imageBanner,
    "features-bar": featuresBar,
    marquee,
  },
});
