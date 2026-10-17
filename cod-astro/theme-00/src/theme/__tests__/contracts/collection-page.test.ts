// @vitest-environment node
/**
 * A collection's page (`/collections/:handle`) lists the collection's products
 * in the merchant's order, a page at a time, with its links in the shopper's
 * language; an empty collection says so and points to the catalog.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { LocaleRouting, ProductList } from "@wocart/storefront";
import CollectionPageContent from "@/theme/components/listing/CollectionPageContent.astro";
import { fr } from "@/theme/content/fr";
import { makeProduct } from "../support/home-render";
import { testLocals } from "../support/locals";

const routing: LocaleRouting = { primary: "ar", published: ["ar", "fr"] };
const collection = { handle: "robes-ete", title: "Robes d'été", description: "Légères et fraîches" };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

async function render(listed: ProductList[], url = "https://example.dz/fr/collections/robes-ete") {
  const asked: unknown[] = [];
  const client = {
    products: {
      list: async (filters: { collection?: string; limit?: number; offset?: number }) => {
        asked.push(filters);
        return listed.slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? listed.length));
      },
    },
  };
  const container = await AstroContainer.create();
  const html = await container.renderToString(CollectionPageContent, {
    props: { collection, currencySymbol: "DA", content: fr },
    locals: testLocals({ locale: "fr", routing, content: fr, client: client as never, pathname: "/collections/robes-ete" }),
    request: new Request(url),
  });
  return { html, asked };
}

describe("a collection's page", () => {
  it("lists its products in the merchant's order, under its title and description", async () => {
    const products = ["c", "a", "b"].map((id) => makeProduct({ id, name: `Robe ${id}`, handle: `robe-${id}` }));
    const { html, asked } = await render(products);
    expect(asked[0]).toMatchObject({ collection: "robes-ete" });
    expect(html).toContain("Robes d&#39;été");
    expect(html).toContain("Légères et fraîches");
    const order = ["/fr/products/robe-c", "/fr/products/robe-a", "/fr/products/robe-b"].map((href) => hrefs(html).indexOf(href));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("pages through a long collection, its links staying in the shopper's language", async () => {
    const products = Array.from({ length: 60 }, (_, i) => makeProduct({ id: `p${i}`, name: `P${i}`, handle: `p-${i}` }));
    const { html } = await render(products);
    expect(hrefs(html).some((href) => href.startsWith("/fr/collections/robes-ete?page=2"))).toBe(true);
  });

  it("says an empty collection is empty, and points to the catalog", async () => {
    const { html } = await render([]);
    expect(html).toContain(fr.noProductsTitle);
    expect(hrefs(html)).toContain("/fr/products");
  });
});
