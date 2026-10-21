import { defineComponent } from "@wocart/theme";
import { storefrontPath } from "@wocart/storefront";
import { FIELD, GROUP, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { collectionRead, copyOverrides, productGridFields, schemeField, styleField } from "../shared";

export const bestSellers = defineComponent({
  type: "best-sellers",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: ProductCollection,
  label: SECTION.bestSellers,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "bestSellersSection", kind: "text", label: FIELD.title, contentKey: "bestSellersSection" },
    { key: "bestSellersSub", kind: "text", label: FIELD.subtitle, contentKey: "bestSellersSub" },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "best-sellers" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
    ...productGridFields,
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    return {
      anchor: "best-sellers",
      title: content.bestSellersSection,
      sub: content.bestSellersSub,
      products: await reads.get(collectionRead(props.collection, props.limit), () =>
        storefront.products.list({ collection: props.collection, limit: props.limit }),
      ),
      viewAll: props.showViewAll ? storefrontPath("collection", { handle: props.collection }) : undefined,
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
});
