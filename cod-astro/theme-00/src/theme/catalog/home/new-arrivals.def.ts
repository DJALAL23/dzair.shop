import { defineComponent } from "@codflow/theme";
import NewArrivals from "@/theme/components/home/NewArrivals.astro";
import { CATALOG_READ, copyOverrides } from "../shared";

export const newArrivals = defineComponent({
  type: "new-arrivals",
  component: NewArrivals,
  label: "New arrivals",
  group: "Home",
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});