import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, SECTION } from "../labels";
import CategoryCards from "@/theme/components/home/CategoryCards.astro";
import { CATALOG_READ, CATEGORIES_READ, copyOverrides } from "../shared";

export const categoryCards = defineComponent({
  type: "category-cards",
  component: CategoryCards,
  label: SECTION.categoryCards,
  group: GROUP.home,
  fields: [
    { key: "categoriesSection", kind: "text", label: FIELD.title, contentKey: "categoriesSection" },
    { key: "limit", kind: "number", label: FIELD.categoriesShown, default: 4, min: 1, max: 12 },
  ],
  load: async ({ storefront, reads, context, props }) => ({
    categories: await reads.get(CATEGORIES_READ, () => storefront.categories.list()),
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    content: copyOverrides(context.content, props),
  }),
  capabilities: { insertable: true },
});