import { defineComponent } from "@wocart/theme";
import { storefrontPath, type Category, type ProductList } from "@wocart/storefront";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { CATEGORIES_READ, schemeField, sectionSpacing, styleField } from "../shared";
import { pageRequest, pageWindow, requestedPage } from "@/theme/utils/pagination";
import ListingMain from "@/theme/components/listing/ListingMain.astro";

/** The read key of a collection by its handle; its route primes it. */
export const collectionByHandle = (handle: string) => `collection:${handle}`;

/** What a listing shows: all products, a category's or a collection's — from the route's `slug` or `handle`. */
export interface ListingView {
  kind: "catalog" | "category" | "collection";
  title: string;
  description: string | null;
  image: string | null;
  products: ProductList[];
  page: number;
  hasNext: boolean;
  first: number;
  last: number;
  /** The listing's own path, for its pages and the active chip. */
  path: string;
  categories: Category[];
  /** The category shown, when the listing is one. */
  active: string | null;
}

/**
 * A list of products: all of them, a category's or a collection's, a page at
 * a time, under the listing's title — with the store's categories as buttons
 * to move between them.
 */
export const listingMain = defineComponent({
  type: "listing-main",
  component: ListingMain,
  label: SECTION.listingMain,
  group: GROUP.listing,
  placement: "section",
  fields: [
    {
      key: "headerAlign",
      kind: "select",
      label: FIELD.headerAlign,
      options: ["center", "start"],
      optionLabels: { center: OPTION.center, start: OPTION.start },
      default: "center",
      display: "segmented",
    },
    { key: "showBreadcrumbs", kind: "boolean", label: FIELD.showBreadcrumbs, default: true },
    { key: "showDescription", kind: "boolean", label: FIELD.showDescription, default: true },
    { key: "showCount", kind: "boolean", label: FIELD.showCount, default: true },
    { key: "showCategoryNav", kind: "boolean", label: FIELD.showCategoryNav, default: true },
    { key: "columns", kind: "number", label: FIELD.columns, min: 2, max: 5, step: 1, default: 4, display: "slider" },
    { key: "headScheme", kind: "colorScheme", label: FIELD.headScheme, default: SCHEME_OF.stone },
    schemeField(),
    styleField(sectionSpacing()),
  ],
  load: async ({ storefront, reads, context }): Promise<{ view: ListingView | null }> => {
    const params = context.params ?? {};
    const page = requestedPage(params.page);
    const categories = await reads.get(CATEGORIES_READ, () => storefront.categories.list());
    const paged = (rows: readonly ProductList[]) => {
      const { items, hasNext, first, last } = pageWindow(rows, page);
      return { products: items, hasNext, first, last, page };
    };
    if (params.handle) {
      const handle = params.handle;
      const collection = await reads.get(collectionByHandle(handle), () => storefront.collections.get(handle));
      if (!collection) return { view: null };
      const rows = await storefront.products.list({ collection: handle, ...pageRequest(page) });
      return { view: { kind: "collection", title: collection.title, description: collection.description, image: null, ...paged(rows), path: storefrontPath("collection", { handle }), categories, active: null } };
    }
    if (params.slug) {
      const category = categories.find((candidate) => candidate.slug === params.slug);
      if (!category) return { view: null };
      const rows = await storefront.products.list({ categoryId: category.id, ...pageRequest(page) });
      return { view: { kind: "category", title: category.name, description: category.description, image: category.imageUrl, ...paged(rows), path: storefrontPath("category", { slug: category.slug }), categories, active: category.slug } };
    }
    const rows = await storefront.products.list(pageRequest(page));
    return { view: { kind: "catalog", title: context.content.allProductsSection ?? "", description: null, image: null, ...paged(rows), path: storefrontPath("catalog"), categories, active: null } };
  },
  capabilities: { insertable: false, surfaces: ["catalog", "category", "collection"] },
});
