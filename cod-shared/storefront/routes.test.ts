import { describe, expect, it } from "vitest";
import { STOREFRONT_PAGE_PATHS, matchStorefrontPath, storefrontPath } from "./routes";

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
    expect(Object.keys(STOREFRONT_PAGE_PATHS)).toEqual(["home", "catalog", "category", "collection", "product", "page", "landing", "checkout", "thankYou", "trackOrder", "search", "contact"]);
  });
});

describe("matchStorefrontPath", () => {
  it("names the page type of each public path, with its decoded parameter", () => {
    expect(matchStorefrontPath("/")).toEqual({ type: "home", params: {} });
    expect(matchStorefrontPath("/products")).toEqual({ type: "catalog", params: {} });
    expect(matchStorefrontPath("/products/robe")).toEqual({ type: "product", params: { handle: "robe" } });
    expect(matchStorefrontPath("/lp/robe-ete")).toEqual({ type: "landing", params: { slug: "robe-ete" } });
    expect(matchStorefrontPath(`/products/${encodeURIComponent("قميص")}`)).toEqual({ type: "product", params: { handle: "قميص" } });
  });

  it("ignores the query, the fragment and a trailing slash", () => {
    expect(matchStorefrontPath("/lp/robe-ete/?fbclid=abc#form")).toEqual({ type: "landing", params: { slug: "robe-ete" } });
    expect(matchStorefrontPath("/products/")).toEqual({ type: "catalog", params: {} });
  });

  it("matches exactly, and answers null for any other path", () => {
    expect(matchStorefrontPath("/productsomething")).toBeNull();
    expect(matchStorefrontPath("/products/a/b")).toBeNull();
    expect(matchStorefrontPath("/about")).toBeNull();
    expect(matchStorefrontPath("/products/%E0%A4%A")).toBeNull();
  });

  it("recognises every page type's own path", () => {
    for (const type of Object.keys(STOREFRONT_PAGE_PATHS) as Array<keyof typeof STOREFRONT_PAGE_PATHS>) {
      const path = STOREFRONT_PAGE_PATHS[type].replace(/:([a-z]+)/g, "x");
      expect(matchStorefrontPath(path)?.type, path).toBe(type);
    }
  });
});
