/**
 * The order-tracking page: the surface, its lookup form and answer, and the
 * content sections an editor may place around them. The track-order route
 * imports only this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import trackOrderDocument from "../../pages/track-order.page.json";
import { trackOrderMain } from "../track-order/track-order-main.def";
import { richText } from "../home/rich-text.def";
import { faq } from "../home/faq.def";
import { featuresBar } from "../home/features-bar.def";
import { whatsappCta } from "../home/whatsapp-cta.def";
import { marquee } from "../home/marquee.def";

export const trackOrderSurface: SurfaceSpec = {
  key: "track-order",
  label: SURFACE.trackOrder,
  pageType: "trackOrder",
  document: trackOrderDocument as PageData,
  required: [{ type: "track-order-main", min: 1, max: 1 }],
};

export const trackOrderCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [trackOrderSurface],
  components: {
    "track-order-main": trackOrderMain,
    "rich-text": richText,
    faq,
    "features-bar": featuresBar,
    "whatsapp-cta": whatsappCta,
    marquee,
  },
});
