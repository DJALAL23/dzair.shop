import { defineComponent } from "@wocart/theme";
import { BLOCK, FIELD, GROUP, HELP, OPTION, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { schemeField, styleField } from "../shared";
import { routeProduct } from "./shared";
import ProductMain from "@/theme/components/product-page/ProductMain.astro";
import ProductGalleryBlock from "@/theme/components/product-page/ProductGalleryBlock.astro";
import ProductTitle from "@/theme/components/product-page/ProductTitle.astro";
import ProductRating from "@/theme/components/product-page/ProductRating.astro";
import ProductPrice from "@/theme/components/product-page/ProductPrice.astro";
import ProductSignals from "@/theme/components/product-page/ProductSignals.astro";
import ProductOrder from "@/theme/components/product-page/ProductOrder.astro";
import ProductCountdown from "@/theme/components/product-page/ProductCountdown.astro";
import ProductDescriptionBlock from "@/theme/components/product-page/ProductDescriptionBlock.astro";
import ProductCollapsible from "@/theme/components/product-page/ProductCollapsible.astro";
import ProductPolicies from "@/theme/components/product-page/ProductPolicies.astro";
import ProductTextBlock from "@/theme/components/product-page/ProductTextBlock.astro";

const ON_PRODUCT = { surfaces: ["product"] };
const load = async (input: Parameters<typeof routeProduct>[0]) => ({ product: await routeProduct(input) });

/** The product's photos: one large, the others as thumbnails beside or under it. Always there. */
export const productGallery = defineComponent({
  type: "product-gallery",
  component: ProductGalleryBlock,
  label: BLOCK.productGallery,
  group: GROUP.product,
  placement: "block",
  fields: [
    {
      key: "thumbnails",
      kind: "select",
      label: FIELD.thumbnails,
      options: ["side", "below"],
      optionLabels: { side: OPTION.side, below: OPTION.below },
      default: "side",
      display: "segmented",
    },
    {
      key: "shape",
      kind: "select",
      label: FIELD.photoShape,
      options: ["portrait", "square"],
      optionLabels: { portrait: OPTION.portrait, square: OPTION.square },
      default: "portrait",
      display: "segmented",
    },
  ],
  load,
  capabilities: { insertable: false, ...ON_PRODUCT },
});

/** The product's name, under its category. */
export const productTitle = defineComponent({
  type: "product-title",
  component: ProductTitle,
  label: BLOCK.productTitle,
  group: GROUP.product,
  placement: "block",
  fields: [{ key: "showCategory", kind: "boolean", label: FIELD.showCategory, default: true }],
  load,
  capabilities: ON_PRODUCT,
});

/** The stars and how many reviews, linking to them, and whether the product is in stock. */
export const productRating = defineComponent({
  type: "product-rating",
  component: ProductRating,
  label: BLOCK.productRating,
  group: GROUP.product,
  placement: "block",
  fields: [{ key: "showStock", kind: "boolean", label: FIELD.showStock, default: true }],
  load,
  capabilities: ON_PRODUCT,
});

/** The price, the old price when it is lower now, and what the shopper saves. */
export const productPrice = defineComponent({
  type: "product-price",
  component: ProductPrice,
  label: BLOCK.productPrice,
  group: GROUP.product,
  placement: "block",
  fields: [{ key: "showSaving", kind: "boolean", label: FIELD.showSaving, default: true }],
  load,
  capabilities: ON_PRODUCT,
});

/** Short facts from real data: the last pieces in stock, and how delivery goes. */
export const productSignals = defineComponent({
  type: "product-signals",
  component: ProductSignals,
  label: BLOCK.productSignals,
  group: GROUP.product,
  placement: "block",
  fields: [
    { key: "showLowStock", kind: "boolean", label: FIELD.showLowStock, default: true },
    { key: "deliveryNote", kind: "text", label: FIELD.deliveryNote, contentKey: "productDeliveryNote" },
  ],
  load,
  capabilities: ON_PRODUCT,
});

/**
 * The order form: the product's options and offers, the shopper's details,
 * the delivery, the amount paid at the door. Its fields are the store's
 * checkout form, set in the merchant dashboard; the theme only styles it.
 * Every product page holds exactly one.
 */
export const productOrder = defineComponent({
  type: "product-order",
  component: ProductOrder,
  label: BLOCK.productOrder,
  group: GROUP.product,
  placement: "block",
  role: "order-form",
  fields: [
    {
      key: "buttonOrder",
      kind: "select",
      label: FIELD.buttonOrder,
      options: ["order-first", "cart-first"],
      optionLabels: { "order-first": OPTION.orderFirst, "cart-first": OPTION.cartFirst },
      default: "order-first",
      display: "segmented",
    },
    { key: "showAssurance", kind: "boolean", label: FIELD.showAssurance, default: true },
    schemeField(SCHEME_OF.stone),
  ],
  load,
  capabilities: { insertable: false, ...ON_PRODUCT },
});

/** A countdown to midnight or to a day the merchant chooses; gone once it ends. */
export const productCountdown = defineComponent({
  type: "product-countdown",
  component: ProductCountdown,
  label: BLOCK.productCountdown,
  group: GROUP.product,
  placement: "block",
  fields: [
    { key: "label", kind: "text", label: FIELD.title, contentKey: "productCountdownLabel" },
    {
      key: "countdown",
      kind: "select",
      label: FIELD.countdown,
      options: ["midnight", "date"],
      optionLabels: { midnight: OPTION.midnight, date: OPTION.onDate },
      default: "midnight",
      display: "segmented",
    },
    { key: "endsOn", kind: "text", label: FIELD.endsOn, description: HELP.endsOn, visibleIf: { field: "countdown", equals: "date" } },
    { key: "endsAt", kind: "text", label: FIELD.endsAt, description: HELP.endsAt, visibleIf: { field: "countdown", equals: "date" } },
  ],
  capabilities: ON_PRODUCT,
});

/** The product's description, in a row that opens and closes. */
export const productDescription = defineComponent({
  type: "product-description",
  component: ProductDescriptionBlock,
  label: BLOCK.productDescription,
  group: GROUP.product,
  placement: "block",
  fields: [
    { key: "title", kind: "text", label: FIELD.title, contentKey: "productDescriptionTitle" },
    { key: "open", kind: "boolean", label: FIELD.openByDefault, default: true },
  ],
  load,
  capabilities: ON_PRODUCT,
});

/** A row that opens and closes: a title, and the merchant's words. */
export const productCollapsible = defineComponent({
  type: "product-collapsible",
  component: ProductCollapsible,
  label: BLOCK.productCollapsible,
  group: GROUP.product,
  placement: "block",
  fields: [
    { key: "title", kind: "text", label: FIELD.title },
    { key: "body", kind: "richtext", label: FIELD.text, formats: ["bold", "italic", "link", "list"] },
    { key: "open", kind: "boolean", label: FIELD.openByDefault, default: false },
  ],
  capabilities: ON_PRODUCT,
});

/** A row linking to the store's own delivery and returns pages, when it has them. */
export const productPolicies = defineComponent({
  type: "product-policies",
  component: ProductPolicies,
  label: BLOCK.productPolicies,
  group: GROUP.product,
  placement: "block",
  fields: [{ key: "title", kind: "text", label: FIELD.title, contentKey: "productPoliciesTitle" }],
  capabilities: ON_PRODUCT,
});

/** A line or two of the merchant's own words. */
export const productText = defineComponent({
  type: "product-text",
  component: ProductTextBlock,
  label: BLOCK.productText,
  group: GROUP.product,
  placement: "block",
  fields: [{ key: "text", kind: "richtext", label: FIELD.text, formats: ["bold", "italic", "link"], inline: true }],
  capabilities: ON_PRODUCT,
});

const INFO_BLOCKS = [
  "product-title",
  "product-rating",
  "product-price",
  "product-signals",
  "product-order",
  "product-countdown",
  "product-description",
  "product-collapsible",
  "product-policies",
  "product-text",
];

/**
 * The product itself: its gallery, always there, beside the column of facts
 * and the order form the merchant arranges. The order form can move but never
 * leave.
 */
export const productMain = defineComponent({
  type: "product-main",
  component: ProductMain,
  label: SECTION.productMain,
  group: GROUP.product,
  placement: "section",
  fixed: [{ name: "gallery", type: "product-gallery", label: BLOCK.productGallery }],
  slots: [{ name: "info", allow: INFO_BLOCKS, max: 16, required: [{ type: "product-order", max: 1 }] }],
  fields: [
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s0", lg: "s5" }, paddingBlockEnd: { base: "s6", lg: "s9" } }, size: { width: { base: "wide" } } }),
  ],
  load,
  capabilities: { insertable: false, ...ON_PRODUCT },
});
