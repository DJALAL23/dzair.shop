import { defineComponent } from "@wocart/theme";
import { storefrontPath, type Product } from "@wocart/storefront";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import ProductCollection from "@/theme/components/home/ProductCollection.astro";
import { collectionRead, copyOverrides, productGridFields, schemeField, styleField } from "../shared";

/** The most products a merchant picks for one section. */
const MAX_PICKED = 12;

/**
 * Products the merchant shows on purpose: a collection's, in the order the
 * dashboard gives them, or products picked one by one in the editor.
 */
export const featuredProducts = defineComponent({
  type: "featured-products",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: ProductCollection,
  label: SECTION.featuredProducts,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "featuredSection", kind: "text", label: FIELD.title, contentKey: "featuredSection" },
    { key: "featuredSub", kind: "text", label: FIELD.subtitle, contentKey: "featuredSub" },
    {
      key: "source",
      kind: "select",
      label: FIELD.source,
      options: ["collection", "picked"],
      optionLabels: { collection: OPTION.fromCollection, picked: OPTION.picked },
      default: "collection",
      display: "segmented",
    },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "featured", visibleIf: { field: "source", equals: "collection" } },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24, visibleIf: { field: "source", equals: "collection" } },
    { key: "products", kind: "productList", label: FIELD.pickedProducts, max: MAX_PICKED, visibleIf: { field: "source", equals: "picked" } },
    ...productGridFields,
    schemeField(),
    styleField(),
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = copyOverrides(context.content, props);
    const picked = props.source === "picked";
    const products = picked
      ? (await Promise.all((props.products ?? []).map((handle) => reads.get(`product:${handle}`, () => storefront.products.get(handle))))).filter(
          (product): product is Product => product !== null,
        )
      : await reads.get(collectionRead(props.collection, props.limit), () => storefront.products.list({ collection: props.collection, limit: props.limit }));
    return {
      anchor: "featured-products",
      title: content.featuredSection,
      sub: content.featuredSub,
      products,
      viewAll: props.showViewAll ? (picked ? storefrontPath("catalog") : storefrontPath("collection", { handle: props.collection })) : undefined,
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
});
