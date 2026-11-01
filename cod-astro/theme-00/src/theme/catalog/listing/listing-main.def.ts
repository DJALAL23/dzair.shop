import { defineComponent } from "@wocart/theme";
import { storefrontPath, type Category, type ProductList, type ProductPage, type ProductSort } from "@wocart/storefront";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import { SCHEME_OF } from "@/theme/appearance";
import { CATEGORIES_READ, schemeField, sectionSpacing, styleField } from "../shared";
import { pageRequest, pageSpan, requestedPage, requestedSort } from "@/theme/utils/pagination";
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
  /** How many products the whole listing holds. */
  total: number;
  /** The order asked for; none is the listing's own. */
  sort: ProductSort | undefined;
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
  capabilities: { surfaces: ["collection", "category", "catalog"] },
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
    { key: "showSort", kind: "boolean", label: FIELD.showSort, default: true },
    { key: "showCategoryNav", kind: "boolean", label: FIELD.showCategoryNav, default: true },
    { key: "columns", kind: "number", label: FIELD.columns, min: 2, max: 5, step: 1, default: 4, display: "slider" },
    { key: "headScheme", kind: "colorScheme", label: FIELD.headScheme, default: SCHEME_OF.stone },
    schemeField(),
    styleField(sectionSpacing()),
  ],
  load: async ({ storefront, reads, context }): Promise<{ view: ListingView | null }> => {
    // The page names its own kind (`surface`, set by the page template), so a
    // collection or category that does not exist shows nothing — never every
    // product in its place.
    const params = context.params ?? {};
    const page = requestedPage(params.page);
    const sort = requestedSort(params.sort);
    const categories = await reads.get(CATEGORIES_READ, () => storefront.categories.list());
    const paged = (result: ProductPage) => ({ products: result.items, hasNext: result.hasNext, total: result.total, page, sort, ...pageSpan(page, result.items.length) });
    if (params.surface === "collection") {
      const handle = params.handle ?? "";
      const collection = handle === "" ? null : await reads.get(collectionByHandle(handle), () => storefront.collections.get(handle));
      if (!collection) return { view: null };
      const result = await storefront.products.page({ collection: handle, ...pageRequest(page, sort) });
      return { view: { kind: "collection", title: collection.title, description: collection.description, image: collection.image?.url ?? null, ...paged(result), path: storefrontPath("collection", { handle }), categories, active: null } };
    }
    if (params.surface === "category") {
      const category = categories.find((candidate) => candidate.slug === params.slug);
      if (!category) return { view: null };
      const result = await storefront.products.page({ categoryId: category.id, ...pageRequest(page, sort) });
      return { view: { kind: "category", title: category.name, description: category.description, image: category.image?.url ?? null, ...paged(result), path: storefrontPath("category", { slug: category.slug }), categories, active: category.slug } };
    }
    const result = await storefront.products.page(pageRequest(page, sort));
    return { view: { kind: "catalog", title: context.content.allProductsSection ?? "", description: null, image: null, ...paged(result), path: storefrontPath("catalog"), categories, active: null } };
  },
});
