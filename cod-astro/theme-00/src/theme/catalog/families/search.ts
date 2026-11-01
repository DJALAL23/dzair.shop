/**
 * The search page: the surface, its search box and results, and the content
 * sections an editor may place around them. The search route imports only
 * this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import searchDocument from "../../pages/search.page.json";
import { searchMain } from "../search/search-main.def";
import { richText } from "../home/rich-text.def";
import { featuresBar } from "../home/features-bar.def";
import { marquee } from "../home/marquee.def";

export const searchSurface: SurfaceSpec = {
  key: "search",
  label: SURFACE.search,
  pageType: "search",
  document: searchDocument as PageData,
  required: [{ type: "search-main", min: 1, max: 1 }],
};

export const searchCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [searchSurface],
  components: {
    "search-main": searchMain,
    "rich-text": richText,
    "features-bar": featuresBar,
    marquee,
  },
});
