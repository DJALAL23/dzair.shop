import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { collectionRead, copyOverrides } from "../shared";

export const newArrivals = defineComponent({
  type: "new-arrivals",
  component: ProductCollection,
  label: SECTION.newArrivals,
  group: GROUP.home,
  fields: [
    { key: "newArrivalsSection", kind: "text", label: FIELD.title, contentKey: "newArrivalsSection" },
    { key: "newArrivalsSub", kind: "text", label: FIELD.subtitle, contentKey: "newArrivalsSub" },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "new-arrivals" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    return {
      anchor: "new-arrivals",
      title: content.newArrivalsSection,
      sub: content.newArrivalsSub,
      products: await reads.get(collectionRead(props.collection, props.limit), () =>
        storefront.products.list({ collection: props.collection, limit: props.limit }),
      ),
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
  capabilities: { insertable: true },
});
