/**
 * The product page: its surface and the product sections it places, including
 * the order form. The product route imports only this catalog.
 */
import { defineTheme, type PageData, type SurfaceSpec } from "@wocart/theme";
import { SURFACE } from "../labels";
import { THEME_KEY } from "../../key";
import { THEME_VERSION } from "../../version";
import productDocument from "../../pages/product.page.json";
import {
  productCollapsible,
  productCountdown,
  productDescription,
  productGallery,
  productMain,
  productOrder,
  productPolicies,
  productPrice,
  productRating,
  productSignals,
  productText,
  productTitle,
} from "../product/product-main.def";
import { productReviews, relatedProducts } from "../product/product-sections.def";

export const productSurface: SurfaceSpec = {
  key: "product",
  label: SURFACE.product,
  pageType: "product",
  document: productDocument as PageData,
  required: [{ type: "product-main", min: 1, max: 1 }],
};

export const productCatalog = defineTheme({
  key: THEME_KEY,
  version: THEME_VERSION,
  surfaces: [productSurface],
  components: {
    "product-main": productMain,
    "product-gallery": productGallery,
    "product-title": productTitle,
    "product-rating": productRating,
    "product-price": productPrice,
    "product-signals": productSignals,
    "product-order": productOrder,
    "product-countdown": productCountdown,
    "product-description": productDescription,
    "product-collapsible": productCollapsible,
    "product-policies": productPolicies,
    "product-text": productText,
    "product-reviews": productReviews,
    "related-products": relatedProducts,
  },
});
