import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import CategoryCards from "@/theme/components/home/CategoryCards.astro";
import { CATALOG_READ, CATEGORIES_READ, copyOverrides, schemeField, styleField } from "../shared";

/** The store's categories as photo tiles, in the dashboard's order, and a tile to every product. */
export const categoryCards = defineComponent({
  type: "category-cards",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: CategoryCards,
  label: SECTION.categoryCards,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "categoriesSection", kind: "text", label: FIELD.title, contentKey: "categoriesSection" },
    { key: "limit", kind: "number", label: FIELD.categoriesShown, default: 4, min: 1, max: 12 },
    { key: "showAll", kind: "boolean", label: FIELD.showAllTile, default: true },
    {
      key: "headingAlign",
      kind: "select",
      label: FIELD.headingAlign,
      options: ["start", "center"],
      optionLabels: { start: OPTION.start, center: OPTION.center },
      default: "start",
      display: "segmented",
    },
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => ({
    categories: await reads.get(CATEGORIES_READ, () => storefront.categories.list()),
    products: await reads.get(CATALOG_READ, () => storefront.products.list()),
    content: copyOverrides(context.content, props),
  }),
});
