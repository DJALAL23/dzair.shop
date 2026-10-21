/**
 * The parts every page shares: the header and footer areas, and the settings
 * and style that shape them. The layout renders these, so it imports only this
 * catalog. The sections an editor may place in the footer are here too, since
 * the footer renders them.
 */
import { defineTheme, type PageData } from "@wocart/theme";
import { AREA } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import { THEME_SETTINGS } from "../../settings";
import { THEME_STYLE } from "../../appearance";
import headerDocument from "../../pages/header.area.json";
import footerDocument from "../../pages/footer.area.json";
import { header } from "../header/header.def";
import { announcement, announcementBar } from "../header/announcement-bar.def";
import { footer, footerAbout, footerMenu, footerPages, footerText } from "../footer/footer.def";
import { richText } from "../home/rich-text.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";
import { marquee } from "../home/marquee.def";

export const shellCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  settings: THEME_SETTINGS,
  style: THEME_STYLE,
  areas: [
    { key: "header", label: AREA.header, document: headerDocument as PageData, required: [{ type: "header", max: 1 }], max: 4 },
    { key: "footer", label: AREA.footer, document: footerDocument as PageData, max: 6 },
  ],
  components: {
    header,
    "announcement-bar": announcementBar,
    announcement,
    footer,
    "footer-about": footerAbout,
    "footer-menu": footerMenu,
    "footer-pages": footerPages,
    "footer-text": footerText,
    "rich-text": richText,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    marquee,
  },
});
