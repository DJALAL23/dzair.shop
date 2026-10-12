import { defineComponent } from "@codflow/theme";
import BestSellers from "@/theme/components/home/BestSellers.astro";
import { CATALOG_READ, copyOverrides } from "../shared";

export const bestSellers = defineComponent({
  type: "best-sellers",
  component: BestSellers,
  label: "Best sellers",
  group: "Home",
  load: async ({ storefront, reads, context, props }) => ({
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    currencySymbol: context.store.currencySymbol,
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});