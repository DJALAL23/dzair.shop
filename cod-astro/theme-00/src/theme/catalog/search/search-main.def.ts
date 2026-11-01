import { defineComponent } from "@wocart/theme";
import type { ProductPage, ProductSort } from "@wocart/storefront";
import { FIELD, GROUP, SECTION } from "../labels";
import { copyOverrides, schemeField, sectionSpacing, styleField } from "../shared";
import { pageRequest, requestedPage, requestedSort } from "@/theme/utils/pagination";
import SearchMain from "@/theme/components/search/SearchMain.astro";

/** What a search shows: the words asked, and the page of products they find. */
export interface SearchView {
  query: string;
  page: number;
  sort: ProductSort | undefined;
  result: ProductPage;
}

/**
 * The search box and the products a shopper's words find, a page at a time,
 * best match first unless an order is chosen. The route hands it the query
 * (`q`), the page and the order from its address.
 */
export const searchMain = defineComponent({
  type: "search-main",
  capabilities: { surfaces: ["search"] },
  component: SearchMain,
  label: SECTION.searchMain,
  group: GROUP.store,
  placement: "section",
  fields: [
    { key: "searchTitle", kind: "text", label: FIELD.title, contentKey: "searchTitle" },
    { key: "searchHint", kind: "text", label: FIELD.intro, contentKey: "searchHint" },
    { key: "showSort", kind: "boolean", label: FIELD.showSort, default: true },
    { key: "columns", kind: "number", label: FIELD.columns, min: 2, max: 5, step: 1, default: 4, display: "slider" },
    schemeField(),
    styleField(sectionSpacing()),
  ],
  load: async ({ storefront, context, props }): Promise<{ content: Record<string, string>; view: SearchView }> => {
    const params = context.params ?? {};
    const query = (params.q ?? "").trim();
    const page = requestedPage(params.page);
    const sort = requestedSort(params.sort);
    const result = query ? await storefront.products.search(query, pageRequest(page, sort)) : { items: [], hasNext: false, total: 0 };
    return { content: copyOverrides(context.content, props), view: { query, page, sort, result } };
  },
});
