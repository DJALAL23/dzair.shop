import { defineComponent } from "@codflow/theme";
import NewArrivals from "@/theme/components/home/NewArrivals.astro";
import { CATALOG_READ, copyOverrides } from "../shared";

export const newArrivals = defineComponent({
  type: "new-arrivals",
  component: NewArrivals,
  label: "New arrivals",
  group: "Home",
  fields: [
    { key: "newArrivalsSection", kind: "text", label: "Title", contentKey: "newArrivalsSection" },
    { key: "newArrivalsSub", kind: "text", label: "Subtitle", contentKey: "newArrivalsSub" },
    { key: "limit", kind: "number", label: "Products shown", default: 8, min: 1, max: 24 },
  ],
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});