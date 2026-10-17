import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { collectionRead, copyOverrides } from "../shared";

export const featuredProducts = defineComponent({
  type: "featured-products",
  component: ProductCollection,
  label: SECTION.featuredProducts,
  group: GROUP.home,
  fields: [
    { key: "featuredSection", kind: "text", label: FIELD.title, contentKey: "featuredSection" },
    { key: "featuredSub", kind: "text", label: FIELD.subtitle, contentKey: "featuredSub" },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "featured" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    return {
      anchor: "featured-products",
      title: content.featuredSection,
      sub: content.featuredSub,
      products: await reads.get(collectionRead(props.collection, props.limit), () =>
        storefront.products.list({ collection: props.collection, limit: props.limit }),
      ),
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
  capabilities: { insertable: true },
});
