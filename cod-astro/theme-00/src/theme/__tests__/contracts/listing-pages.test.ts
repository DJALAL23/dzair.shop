// @vitest-environment node
/**
 * The listing pages and the text pages, each rendered as the store renders
 * it: its section through the SDK's renderer, with the route's parameters.
 *
 * A collection lists its products in the merchant's order, a page at a time,
 * its links in the shopper's language; a category marks itself among the
 * store's categories; all products lists the catalog; an empty listing says
 * so and leads on. A text page shows its title and the platform's sanitised
 * body as given.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import InstanceView from "@wocart/theme/astro/InstanceView.astro";
import { createReadCache } from "@wocart/theme/astro";
import type { Category, LocaleRouting, ProductList } from "@wocart/storefront";
import { theme00 } from "@/theme/theme";
import { fr } from "@/theme/content/fr";
import { makeProduct } from "../support/home-render";
import { testLocals, TEST_CONFIG } from "../support/locals";

const routing: LocaleRouting = { primary: "ar", published: ["ar", "fr"] };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);
const category = (slug: string, name: string): Category =>
  ({ id: `cat_${slug}`, name, slug, description: `Tout en ${name}`, parentId: null, image: null, metaTitle: null, metaDescription: null, metaKeywords: null, position: 0, createdAt: "", updatedAt: "" }) as Category;
const CATEGORIES = [category("robes", "Robes"), category("sacs", "Sacs")];

/**
 * A listing's params name its kind, as the page template passes them: `surface` is the page's own.
 * The catalog answers a page as the SDK does.
 */
async function render(type: "listing-main" | "page-main", params: Record<string, string>, listed: ProductList[] = []) {
  const asked: Array<Record<string, unknown>> = [];
  const client = {
    products: {
      page: async (filters: { collection?: string; categoryId?: string; limit?: number; offset?: number; sort?: string }) => {
        asked.push(filters);
        const offset = filters.offset ?? 0;
        const limit = filters.limit ?? listed.length;
        return { items: listed.slice(offset, offset + limit), hasNext: offset + limit < listed.length, total: listed.length };
      },
    },
    collections: { get: async (handle: string) => (handle === "robes-ete" ? { handle, title: "Robes d'été", description: "Légères et fraîches" } : null) },
    categories: { list: async () => CATEGORIES },
    pages: { get: async (slug: string) => (slug === "livraison" ? { id: "p1", kind: "shipping", slug, locale: "fr", title: "Livraison", bodyHtml: "<p>Partout en <strong>58 wilayas</strong>.</p>", metaTitle: null, metaDescription: null } : null) },
  };
  const container = await AstroContainer.create();
  const html = await container.renderToString(InstanceView, {
    props: {
      instance: { id: "main", type, props: {} },
      theme: theme00,
      context: { store: TEST_CONFIG, content: fr, locale: "fr", isRTL: false, url: "/", params },
      storefront: client as never,
      reads: createReadCache(),
    },
    locals: testLocals({ locale: "fr", routing, content: fr, client: client as never, pathname: "/" }),
  });
  return { html, asked };
}

describe("a collection's page", () => {
  it("lists its products in the merchant's order, under its title and description", async () => {
    const products = ["c", "a", "b"].map((id) => makeProduct({ id, name: `Robe ${id}`, handle: `robe-${id}` }));
    const { html, asked } = await render("listing-main", { surface: "collection", handle: "robes-ete" }, products);
    expect(asked[0]).toMatchObject({ collection: "robes-ete" });
    expect(html).toContain("Robes d&#39;été");
    expect(html).toContain("Légères et fraîches");
    expect(html).toContain("3 produits");
    const order = ["/fr/products/robe-c", "/fr/products/robe-a", "/fr/products/robe-b"].map((href) => hrefs(html).indexOf(href));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("pages through a long collection, its links staying in the shopper's language", async () => {
    const products = Array.from({ length: 60 }, (_, i) => makeProduct({ id: `p${i}`, name: `P${i}`, handle: `p-${i}` }));
    const first = await render("listing-main", { surface: "collection", handle: "robes-ete" }, products);
    expect(hrefs(first.html)).toContain("/fr/collections/robes-ete?page=2");
    expect(first.html).toContain("1–24 sur 60 produits");
    expect(first.html).toContain('aria-label="Page 1 sur 3"');
    const second = await render("listing-main", { surface: "collection", handle: "robes-ete", page: "2" }, products);
    expect(second.asked[0]).toMatchObject({ offset: 24, limit: 24 });
    expect(hrefs(second.html)).toContain("/fr/collections/robes-ete");
    expect(second.html).toContain("25–48 sur 60 produits");
  });

  it("lists in the order the shopper chose, keeping it on every page, and offers the platform's orders", async () => {
    const products = Array.from({ length: 30 }, (_, i) => makeProduct({ id: `p${i}`, name: `P${i}`, handle: `p-${i}` }));
    const { html, asked } = await render("listing-main", { surface: "collection", handle: "robes-ete", sort: "price-ascending" }, products);
    expect(asked[0]).toMatchObject({ sort: "price-ascending" });
    expect(hrefs(html)).toContain("/fr/collections/robes-ete?page=2&amp;sort=price-ascending");
    expect(html).toMatch(/<form class="listing-sort[^"]*" method="get" action="\/fr\/collections\/robes-ete"/);
    expect(html).toMatch(/<option value="price-ascending" selected[^>]*>Prix croissant<\/option>/);
    for (const label of [fr.sortDefault, fr.sortNewest, fr.sortPriceDescending]) expect(html).toContain(label);
    const unknown = await render("listing-main", { surface: "collection", handle: "robes-ete", sort: "cheapest" }, products);
    expect(unknown.asked[0]).not.toHaveProperty("sort");
  });

  it("says an empty collection is empty, and points to the catalog", async () => {
    const { html } = await render("listing-main", { surface: "collection", handle: "robes-ete" });
    expect(html).toContain(fr.noProductsTitle);
    expect(hrefs(html)).toContain("/fr/products");
  });

  it("renders nothing for a collection that does not exist (the route answered 404 first)", async () => {
    expect((await render("listing-main", { surface: "collection", handle: "nope" })).html).not.toContain("listing-title");
    // Without a collection named at all, the page shows nothing — not every product in its place.
    expect((await render("listing-main", { surface: "collection" }, [makeProduct({ id: "x", name: "X", handle: "x" })])).html).not.toContain("listing-title");
  });
});

describe("a category's page and all products", () => {
  it("lists the category's products and marks it among the store's categories", async () => {
    const { html, asked } = await render("listing-main", { surface: "category", slug: "sacs" }, [makeProduct({ id: "s", name: "Sac", handle: "sac" })]);
    expect(asked[0]).toMatchObject({ categoryId: "cat_sacs" });
    expect(html).toMatch(/<a href="\/fr\/category\/sacs"[^>]*class="chip is-on"[^>]*aria-current="page"/);
    expect(html).toMatch(/<a href="\/fr\/products"[^>]*class="chip"/);
    expect(html).toContain("1 produit");
  });

  it("shows nothing for a category that does not exist", async () => {
    expect((await render("listing-main", { surface: "category", slug: "nope" })).html).not.toContain("listing-title");
  });

  it("lists the catalog with every category as a way in", async () => {
    const { html, asked } = await render("listing-main", { surface: "catalog" }, [makeProduct({ id: "a", name: "A", handle: "a" })]);
    expect(asked[0]).not.toHaveProperty("categoryId");
    expect(asked[0]).not.toHaveProperty("collection");
    expect(html).toContain(fr.allProductsSection);
    expect(html).toMatch(/<a href="\/fr\/products"[^>]*class="chip is-on"/);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/fr/category/robes", "/fr/category/sacs"]));
  });

  it("says an empty store is being set up", async () => {
    expect((await render("listing-main", { surface: "catalog" })).html).toContain(fr.emptyStoreTitle);
  });
});

describe("a text page", () => {
  it("shows its title and the sanitised body as given", async () => {
    const { html } = await render("page-main", { slug: "livraison" });
    expect(html).toContain(">Livraison</h1>");
    expect(html).toContain("<p>Partout en <strong>58 wilayas</strong>.</p>");
  });

  it("renders nothing for a page that does not exist", async () => {
    expect((await render("page-main", { slug: "nope" })).html).not.toContain("page-title");
  });
});
