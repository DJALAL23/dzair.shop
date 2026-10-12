/**
 * Test support for the home surface: one product factory and one way to render
 * sections through the real renderer (`InstanceView` + `theme00`), so contract
 * tests exercise exactly the path `pages/index.astro` takes.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { Category, ProductList } from "@codflow/storefront";
import type { StoreClient } from "@codflow/storefront/server";
import InstanceView from "@codflow/theme/astro/InstanceView.astro";
import { createReadCache, type RendererIssue } from "@codflow/theme/astro";
import type { ComponentInstance, ThemeRenderContext } from "@codflow/theme";
import { theme00 } from "@/theme/theme";
import { DEFAULT_CONFIG } from "@/theme/runtime/store";
import { en } from "@/theme/content/en";
import type { LocaleRouting } from "@codflow/storefront";
import { testLocals } from "./locals";

export function makeProduct(overrides: Partial<ProductList>): ProductList {
  return {
    id: "prod_x",
    name: "Fixture Product",
    description: null,
    descriptionFormat: "text",
    descriptionPlain: null,
    handle: "fixture-product",
    currency: "DZD",
    price: 4500,
    compareAtPrice: null,
    costPrice: null,
    type: "PHYSICAL",
    hasVariants: false,
    variantOptions: null,
    sku: null,
    inventory: 12,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    tags: null,
    visibility: true,
    status: "ACTIVE",
    showInStore: true,
    storeFeatured: false,
    deletedAt: null,
    publishedAt: "2026-08-03T10:00:00.000Z",
    createdAt: "2026-08-03T09:58:12.000Z",
    updatedAt: "2026-09-19T14:21:44.000Z",
    coverImage: null,
    reviewStats: null,
    ...overrides,
  };
}

/** A storefront stand-in that serves fixed catalog reads. */
export function fakeStorefront(products: ProductList[], categories: Category[] = []): StoreClient {
  return {
    products: { list: async () => products },
    categories: { list: async () => categories },
  } as unknown as StoreClient;
}

/** Render sections the way the home page does: one context, one read cache. */
export async function renderSections(
  sections: ComponentInstance[],
  storefront: StoreClient,
  options: {
    content?: Record<string, string>;
    locale?: string;
    /** The store's languages, for links: `/products` → `/fr/products` in French. */
    routing?: LocaleRouting;
    onIssue?: (issue: RendererIssue) => void;
  } = {},
): Promise<string> {
  const context: ThemeRenderContext = {
    store: DEFAULT_CONFIG,
    content: options.content ?? en,
    locale: options.locale ?? "en",
    fallbackLocales: [],
    isRTL: options.locale === "ar",
    url: "/",
    params: {},
  };
  const reads = createReadCache();
  const container = await AstroContainer.create();
  let html = "";
  for (const instance of sections) {
    html += await container.renderToString(InstanceView, {
      props: { instance, theme: theme00, context, storefront, reads, onIssue: options.onIssue },
      locals: testLocals({ locale: context.locale, routing: options.routing ?? { primary: context.locale, published: [context.locale] } }),
    });
  }
  return html;
}
