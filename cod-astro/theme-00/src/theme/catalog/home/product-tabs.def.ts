import { defineComponent } from "@wocart/theme";
import { storefrontPath, type Product, type ProductList } from "@wocart/storefront";
import { BLOCK, FIELD, GROUP, OPTION, SECTION } from "../labels";
import ProductTabs from "@/theme/components/home/ProductTabs.astro";
import ProductTab from "@/theme/components/home/ProductTab.astro";
import { collectionRead, copyOverrides, onSaleRead, productGridFields, schemeField, styleField } from "../shared";

/** The most products a merchant picks for one tab. */
const MAX_PICKED = 12;

/**
 * One tab: a collection's products, the products on sale, or products picked
 * one by one. Unnamed, it takes its collection's name.
 */
export const productTab = defineComponent({
  type: "product-tab",
  capabilities: { insertable: true, surfaces: ["home"] },
  component: ProductTab,
  label: BLOCK.productTab,
  group: GROUP.home,
  placement: "block",
  fields: [
    { key: "label", kind: "text", label: FIELD.tabLabel },
    {
      key: "source",
      kind: "select",
      label: FIELD.source,
      options: ["collection", "onSale", "picked"],
      optionLabels: { collection: OPTION.fromCollection, onSale: OPTION.onSale, picked: OPTION.picked },
      default: "collection",
      display: "segmented",
    },
    { key: "collection", kind: "collection", label: FIELD.collection, default: "best-sellers", visibleIf: { field: "source", equals: "collection" } },
    { key: "products", kind: "productList", label: FIELD.pickedProducts, max: MAX_PICKED, visibleIf: { field: "source", equals: "picked" } },
    { key: "limit", kind: "number", label: FIELD.productsShown, default: 8, min: 1, max: 24, visibleIf: { field: "source", in: ["collection", "onSale"] } },
  ],
  load: async ({ storefront, reads, context, props }) => {
    const content = context.content;
    if (props.source === "picked") {
      const products = (await Promise.all((props.products ?? []).map((handle) => reads.get(`product:${handle}`, () => storefront.products.get(handle))))).filter(
        (product): product is Product => product !== null,
      );
      return { name: props.label || content.featuredSection, products: products as Array<ProductList | Product>, viewAll: storefrontPath("catalog"), currencySymbol: context.store.currencySymbol, content };
    }
    if (props.source === "onSale") {
      const products = await reads.get(onSaleRead(props.limit), () => storefront.products.list({ onSale: true, limit: props.limit }));
      return { name: props.label || content.onSaleSection, products, viewAll: storefrontPath("catalog"), currencySymbol: context.store.currencySymbol, content };
    }
    const [collection, products] = await Promise.all([
      reads.get(`collection:${props.collection}`, () => storefront.collections.get(props.collection)),
      reads.get(collectionRead(props.collection, props.limit), () => storefront.products.list({ collection: props.collection, limit: props.limit })),
    ]);
    return {
      name: props.label || collection?.title || content.featuredSection,
      products,
      viewAll: storefrontPath("collection", { handle: props.collection }),
      currencySymbol: context.store.currencySymbol,
      content,
    };
  },
});

/** Several lists of products under one title, a tab for each. */
export const productTabs = defineComponent({
  type: "product-tabs",
  component: ProductTabs,
  label: SECTION.productTabs,
  group: GROUP.home,
  placement: "section",
  slots: [{ name: "tabs", allow: ["product-tab"], max: 4 }],
  fields: [
    { key: "productTabsTitle", kind: "text", label: FIELD.title, contentKey: "productTabsTitle" },
    { key: "productTabsSub", kind: "text", label: FIELD.subtitle, contentKey: "productTabsSub" },
    ...productGridFields,
    schemeField(),
    styleField(),
  ],
  load: async ({ context, props }) => ({ content: copyOverrides(context.content, props) }),
  capabilities: { insertable: true, surfaces: ["home"] },
  presets: [
    {
      key: "default",
      label: SECTION.productTabs,
      slots: {
        tabs: [
          { type: "product-tab", props: { collection: "best-sellers" } },
          { type: "product-tab", props: { collection: "new-arrivals" } },
          { type: "product-tab", props: { source: "onSale" } },
        ],
      },
    },
  ],
});
