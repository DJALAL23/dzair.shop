import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import FeaturedProduct from "@/theme/components/home/FeaturedProduct.astro";
import { copyOverrides, schemeField, styleField } from "../shared";

export const featuredProduct = defineComponent({
  type: "featured-product",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: FeaturedProduct,
  label: SECTION.featuredProduct,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "product", kind: "product", label: FIELD.product },
    { key: "featuredProductTitle", kind: "text", label: FIELD.title, contentKey: "featuredProductTitle" },
    { key: "featuredProductCta", kind: "text", label: FIELD.button, contentKey: "featuredProductCta" },
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => ({
    // One read per product per render, shared with any other section showing it.
    featured: props.product === undefined ? null : await reads.get(`product:${props.product}`, () => storefront.products.get(props.product ?? "")),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
});
