/**
 * The checkout page: the surface, the basket's checkout, and the few content
 * sections an editor may place around it. The checkout route imports only
 * this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import checkoutDocument from "../../pages/checkout.page.json";
import { checkoutMain } from "../checkout/checkout-main.def";
import { richText } from "../home/rich-text.def";
import { featuresBar } from "../home/features-bar.def";

export const checkoutSurface: SurfaceSpec = {
  key: "checkout",
  label: SURFACE.checkout,
  pageType: "checkout",
  document: checkoutDocument as PageData,
  required: [{ type: "checkout-main", min: 1, max: 1 }],
};

export const checkoutCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [checkoutSurface],
  components: {
    "checkout-main": checkoutMain,
    "rich-text": richText,
    "features-bar": featuresBar,
  },
});
