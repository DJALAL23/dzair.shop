import { describe, expect, it } from "vitest";
import { sitemapXml } from "@wocart/storefront/server";

describe("sitemapXml", () => {
  it("lists every page once per published language, each with all its alternates", () => {
    const xml = sitemapXml(["/", "/products/phone"], { primary: "ar", published: ["ar", "fr"] }, "https://shop.dz/");
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([
      "https://shop.dz/",
      "https://shop.dz/fr",
      "https://shop.dz/products/phone",
      "https://shop.dz/fr/products/phone",
    ]);
    const frenchProduct = xml.split("<url>").find((block) => block.includes("<loc>https://shop.dz/fr/products/phone</loc>"))!;
    expect(frenchProduct).toContain('hreflang="ar" href="https://shop.dz/products/phone"');
    expect(frenchProduct).toContain('hreflang="fr" href="https://shop.dz/fr/products/phone"');
    expect(frenchProduct).toContain('hreflang="x-default" href="https://shop.dz/products/phone"');
  });

  it("is a plain sitemap for a one-language store, without alternates", () => {
    const xml = sitemapXml(["/", "/products"], { primary: "ar", published: ["ar"] }, "https://shop.dz");
    expect(xml).not.toContain("xhtml:link rel");
    expect([...xml.matchAll(/<loc>/g)]).toHaveLength(2);
  });

  it("escapes URLs and drops duplicate paths", () => {
    const xml = sitemapXml(["/pages/a&b", "/pages/a&b"], { primary: "ar", published: ["ar"] }, "https://shop.dz");
    expect(xml).toContain("<loc>https://shop.dz/pages/a&amp;b</loc>");
    expect([...xml.matchAll(/<loc>/g)]).toHaveLength(1);
  });
});
