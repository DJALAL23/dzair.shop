import { describe, expect, it } from "vitest";
import { LISTING_PAGE_SIZE, listingHref, pageCount, pageRequest, pageSpan, requestedPage, requestedSort } from "../pagination";

describe("requestedPage", () => {
  it("reads a whole number from 1 up", () => {
    expect(requestedPage("1")).toBe(1);
    expect(requestedPage("3")).toBe(3);
  });

  it("falls back to page 1 for anything else", () => {
    for (const raw of [null, undefined, "", "0", "-2", "abc", "2.5", "1e3", "99999999999999999999"]) {
      expect(requestedPage(raw)).toBe(1);
    }
  });

  it("caps a page far past the catalogue", () => {
    expect(requestedPage("10001")).toBe(1);
    expect(requestedPage("10000")).toBe(10000);
  });
});

describe("requestedSort", () => {
  it("takes an order the SDK offers, and none for anything else", () => {
    expect(requestedSort("price-ascending")).toBe("price-ascending");
    expect(requestedSort("newest")).toBe("newest");
    for (const raw of [null, undefined, "", "price", "PRICE-ASCENDING", "toString"]) expect(requestedSort(raw)).toBeUndefined();
  });
});

describe("pageRequest", () => {
  it("asks for one page of rows, offset past the earlier pages, in the order asked", () => {
    expect(pageRequest(1, undefined)).toEqual({ limit: LISTING_PAGE_SIZE, offset: 0 });
    expect(pageRequest(3, "newest")).toEqual({ limit: LISTING_PAGE_SIZE, offset: 2 * LISTING_PAGE_SIZE, sort: "newest" });
  });
});

describe("pageSpan and pageCount", () => {
  it("numbers a page's rows, and nothing for a page past the end", () => {
    expect(pageSpan(1, LISTING_PAGE_SIZE)).toEqual({ first: 1, last: LISTING_PAGE_SIZE });
    expect(pageSpan(2, 12)).toEqual({ first: LISTING_PAGE_SIZE + 1, last: LISTING_PAGE_SIZE + 12 });
    expect(pageSpan(4, 0)).toEqual({ first: 0, last: 3 * LISTING_PAGE_SIZE });
  });

  it("counts the pages a total fills, at least one", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(LISTING_PAGE_SIZE)).toBe(1);
    expect(pageCount(LISTING_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("listingHref", () => {
  it("keeps the order on every page and leaves the first page bare", () => {
    expect(listingHref("/fr/products", 1, undefined)).toBe("/fr/products");
    expect(listingHref("/fr/products", 1, "newest")).toBe("/fr/products?sort=newest");
    expect(listingHref("/fr/products", 3, "price-descending")).toBe("/fr/products?page=3&sort=price-descending");
    expect(listingHref("/category/robes", 2, undefined)).toBe("/category/robes?page=2");
    expect(listingHref("/fr/search", 2, "newest", { q: "robe été" })).toBe("/fr/search?q=robe+%C3%A9t%C3%A9&page=2&sort=newest");
  });
});
