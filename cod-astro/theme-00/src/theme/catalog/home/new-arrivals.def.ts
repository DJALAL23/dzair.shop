import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import NewArrivals from "@/theme/components/home/NewArrivals.astro";
import { collectionRead, copyOverrides } from "../shared";

export const newArrivals = defineComponent({
  type: "new-arrivals",
  component: NewArrivals,
  label: SECTION.newArrivals,
  group: GROUP.home,
  fields: [
    { key: "newArrivalsSection", kind: "text", label: FIELD.title, contentKey: "newArrivalsSection" },
    { key: "newArrivalsSub", kind: "text", label: FIELD.subtitle, contentKey: "newArrivalsSub" },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "new-arrivals" },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24 },
  ],
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(collectionRead(props.collection, props.limit), () =>
      storefront.products.list({ collection: props.collection, limit: props.limit }),
    ),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});