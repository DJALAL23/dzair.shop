import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, schemeField, sectionSpacing, styleField } from "../shared";
import { routeProduct } from "./shared";
import ProductReviews from "@/theme/components/product-page/ProductReviews.astro";
import ProductRelated from "@/theme/components/product-page/ProductRelated.astro";

const ON_PRODUCT = { surfaces: ["product"] };

/**
 * A preview shows the product's deferred islands (reviews, related products)
 * inline: the live page streams them after the product is on screen, and an
 * editor must see them where they are placed.
 */
const inPreview = (input: { context: { params?: Readonly<Record<string, string | undefined>> } }) => input.context.params?.preview === "true";

/** What shoppers who received the product say about it, and the form to add a review — on a landing page, of the product it sells. */
export const productReviews = defineComponent({
  type: "product-reviews",
  component: ProductReviews,
  label: SECTION.productReviews,
  group: GROUP.product,
  placement: "section",
  fields: [
    { key: "reviewsTitle", kind: "text", label: FIELD.title, contentKey: "reviewsTitle" },
    { key: "reviewsEmpty", kind: "text", label: FIELD.emptyNote, contentKey: "reviewsEmpty" },
    { key: "showForm", kind: "boolean", label: FIELD.showReviewForm, default: true },
    schemeField(),
    styleField(),
  ],
  load: async (input) => ({ product: await routeProduct(input), content: copyOverrides(input.context.content, input.props), inline: inPreview(input) }),
  capabilities: { insertable: true, surfaces: ["product", "landing"] },
});

/** Products from the same category, for the shopper who decides this one is not it. */
export const relatedProducts = defineComponent({
  type: "related-products",
  component: ProductRelated,
  label: SECTION.relatedProducts,
  group: GROUP.product,
  placement: "section",
  fields: [
    { key: "relatedTitle", kind: "text", label: FIELD.title, contentKey: "relatedTitle" },
    { key: "relatedSub", kind: "text", label: FIELD.subtitle, contentKey: "relatedSub" },
    schemeField(SCHEME_OF.stone),
    styleField(sectionSpacing(true)),
  ],
  load: async (input) => ({ product: await routeProduct(input), content: copyOverrides(input.context.content, input.props), inline: inPreview(input) }),
  capabilities: { insertable: true, ...ON_PRODUCT },
});
