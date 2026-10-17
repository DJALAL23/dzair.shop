import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { copyOverrides, onSaleRead } from "../shared";

/** The products priced below their compare-at price — computed by the platform, never picked. */
export const onSale = defineComponent({
  type: "on-sale",
  component: ProductCollection,
  label: SECTION.onSale,
  group: GROUP.home,
  fields: [
    { key: "onSaleSection", kind: "text", label: FIELD.title, contentKey: "onSaleSection" },
    { key: "onSaleSub", kind: "text", label: FIELD.subtitle, contentKey: "onSaleSub" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    return {
      anchor: "on-sale",
      title: content.onSaleSection,
      sub: content.onSaleSub,
      products: await reads.get(onSaleRead(props.limit), () => storefront.products.list({ onSale: true, limit: props.limit })),
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
  capabilities: { insertable: true },
});
