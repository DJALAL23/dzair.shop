import { describe, expect, it } from "vitest";
import { STOREFRONT_PAGE_PATHS, storefrontPath } from "./routes";

describe("storefront page paths", () => {
  it("builds each page type's public path", () => {
    expect(storefrontPath("home")).toBe("/");
    expect(storefrontPath("catalog")).toBe("/products");
    expect(storefrontPath("product", { handle: "robe" })).toBe("/products/robe");
    expect(storefrontPath("category", { slug: "robes" })).toBe("/category/robes");
    expect(storefrontPath("page", { slug: "terms" })).toBe("/pages/terms");
    expect(storefrontPath("landing", { slug: "robe-ete" })).toBe("/lp/robe-ete");
    expect(storefrontPath("checkout")).toBe("/checkout");
    expect(storefrontPath("thankYou")).toBe("/thank-you");
  });

  it("encodes a parameter, and refuses a missing one", () => {
    expect(storefrontPath("product", { handle: "قميص كلاسيكي" })).toBe(`/products/${encodeURIComponent("قميص كلاسيكي")}`);
    expect(storefrontPath("product", { handle: "a/b?c" })).toBe("/products/a%2Fb%3Fc");
    expect(() => storefrontPath("landing", { slug: "" })).toThrow(/needs "slug"/);
  });

  it("names every page type the platform links to", () => {
    expect(Object.keys(STOREFRONT_PAGE_PATHS)).toEqual(["home", "catalog", "category", "collection", "product", "page", "landing", "checkout", "thankYou"]);
  });
});
