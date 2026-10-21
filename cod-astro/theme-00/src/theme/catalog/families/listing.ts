/**
 * The listing pages — all products, a category and a collection — share one
 * section. Their catalog holds only that section and the three surfaces.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import collectionDocument from "../../pages/collection.page.json";
import categoryDocument from "../../pages/category.page.json";
import catalogDocument from "../../pages/catalog.page.json";
import { listingMain } from "../listing/listing-main.def";
import { featuresBar } from "../home/features-bar.def";

export const collectionSurface: SurfaceSpec = {
  key: "collection",
  label: SURFACE.collection,
  pageType: "collection",
  document: collectionDocument as PageData,
  required: [{ type: "listing-main", min: 1, max: 1 }],
};

export const categorySurface: SurfaceSpec = {
  key: "category",
  label: SURFACE.category,
  pageType: "category",
  document: categoryDocument as PageData,
  required: [{ type: "listing-main", min: 1, max: 1 }],
};

export const catalogSurface: SurfaceSpec = {
  key: "catalog",
  label: SURFACE.catalog,
  pageType: "catalog",
  document: catalogDocument as PageData,
  required: [{ type: "listing-main", min: 1, max: 1 }],
};

export const listingCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [collectionSurface, categorySurface, catalogSurface],
  components: { "listing-main": listingMain, "features-bar": featuresBar },
});
