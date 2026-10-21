import { defineComponent } from "@wocart/theme";
import { storefrontPath } from "@wocart/storefront";
import { FIELD, GROUP, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { copyOverrides, onSaleRead, productGridFields, schemeField, styleField } from "../shared";

export const onSale = defineComponent({
  type: "on-sale",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: ProductCollection,
  label: SECTION.onSale,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "onSaleSection", kind: "text", label: FIELD.title, contentKey: "onSaleSection" },
    { key: "onSaleSub", kind: "text", label: FIELD.subtitle, contentKey: "onSaleSub" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
    ...productGridFields,
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    return {
      anchor: "on-sale",
      title: content.onSaleSection,
      sub: content.onSaleSub,
      products: await reads.get(onSaleRead(props.limit), () => storefront.products.list({ onSale: true, limit: props.limit })),
      viewAll: props.showViewAll ? storefrontPath("catalog") : undefined,
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
});
