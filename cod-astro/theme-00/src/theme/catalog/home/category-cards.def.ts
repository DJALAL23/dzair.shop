import { defineComponent } from "@codflow/theme";
import CategoryCards from "@/theme/components/home/CategoryCards.astro";
import { CATEGORIES_READ, copyOverrides } from "../shared";

export const categoryCards = defineComponent({
  type: "category-cards",
  component: CategoryCards,
  label: "Category cards",
  group: "Home",
  load: async ({ storefront, reads, context, props }) => ({
    categories: await reads.get(CATEGORIES_READ, () => storefront.categories.list()),
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});