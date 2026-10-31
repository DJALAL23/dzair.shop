import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, HELP, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { copyOverrides, schemeField, styleField } from "../shared";
import { routeLanding } from "../product/shared";
import LandingImages from "@/theme/components/landing/LandingImages.astro";
import LandingOrder from "@/theme/components/landing/LandingOrder.astro";
import LandingProduct from "@/theme/components/landing/LandingProduct.astro";

const ON_LANDING = { surfaces: ["landing"] };

/**
 * The landing page's own images, in their saved order with the page's gap:
 * all, or a range (from image N, so many), so a section can sit between two
 * parts of the stack.
 */
export const landingImages = defineComponent({
  type: "landing-images",
  capabilities: { insertable: true, ...ON_LANDING },
  component: LandingImages,
  label: SECTION.landingImages,
  group: GROUP.landing,
  placement: "section",
  fields: [
    { key: "first", kind: "number", label: FIELD.firstImage, description: HELP.firstImage, default: 1, min: 1, max: 40, step: 1 },
    { key: "count", kind: "number", label: FIELD.imageCount, description: HELP.imageCount, default: 0, min: 0, max: 40, step: 1 },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s0" }, paddingBlockEnd: { base: "s0" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async (input) => ({ landing: await routeLanding(input) }),
  presets: [
    { key: "opening", label: { ar: "الصور الأولى", fr: "Premières images", en: "Opening images" }, props: { first: 1, count: 3 } },
    { key: "rest", label: { ar: "بقية الصور", fr: "Images suivantes", en: "The other images" }, props: { first: 4, count: 0 } },
  ],
});

/** The landing page's one order form: the product's options and offers, then the cash-on-delivery form. */
export const landingOrder = defineComponent({
  type: "landing-order",
  capabilities: { insertable: false, ...ON_LANDING },
  component: LandingOrder,
  label: SECTION.landingOrder,
  group: GROUP.landing,
  placement: "section",
  role: "order-form",
  fields: [
    { key: "showAssurance", kind: "boolean", label: FIELD.showAssurance, default: true },
    { key: "stickyCta", kind: "boolean", label: FIELD.stickyCta, default: true },
    { key: "orderCta", kind: "text", label: FIELD.stickyCtaLabel, contentKey: "orderCta", visibleIf: { field: "stickyCta", equals: true } },
    schemeField(SCHEME_OF.stone),
    styleField({ spacing: { paddingBlockStart: { base: "s7" }, paddingBlockEnd: { base: "s7" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async (input) => ({ landing: await routeLanding(input), content: copyOverrides(input.context.content, input.props), inline: input.context.params?.preview === "true" }),
});

/** The product a landing page sells, in a line: its name, its price, its stars. For a page whose images do not say it. */
export const landingProduct = defineComponent({
  type: "landing-product",
  capabilities: { insertable: true, ...ON_LANDING },
  component: LandingProduct,
  label: SECTION.landingProduct,
  group: GROUP.landing,
  placement: "section",
  fields: [
    { key: "showRating", kind: "boolean", label: FIELD.showRating, default: true },
    schemeField(),
    styleField({ spacing: { paddingBlockStart: { base: "s6" }, paddingBlockEnd: { base: "s4" } }, size: { width: { base: "narrow" } } }),
  ],
  load: async (input) => ({ landing: await routeLanding(input) }),
});
