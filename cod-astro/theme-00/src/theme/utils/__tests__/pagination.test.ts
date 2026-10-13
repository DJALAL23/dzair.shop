import { describe, expect, it } from "vitest";
import { LISTING_PAGE_SIZE, pageRequest, pageWindow, requestedPage } from "../pagination";

const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

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

describe("pageRequest", () => {
  it("asks for one page of rows, offset past the earlier pages, and one row to look ahead", () => {
    expect(pageRequest(1)).toEqual({ limit: LISTING_PAGE_SIZE + 1, offset: 0 });
    expect(pageRequest(3)).toEqual({ limit: LISTING_PAGE_SIZE + 1, offset: 2 * LISTING_PAGE_SIZE });
  });
});

describe("pageWindow", () => {
  it("shows a full first page and says a next page exists when the look-ahead row came back", () => {
    const window = pageWindow(rows(LISTING_PAGE_SIZE + 1), 1);
    expect(window.items).toHaveLength(LISTING_PAGE_SIZE);
    expect(window.hasNext).toBe(true);
    expect(window).toMatchObject({ first: 1, last: LISTING_PAGE_SIZE });
  });

  it("shows the rest on the last page, with no next page", () => {
    const window = pageWindow(rows(12), 2);
    expect(window.items).toHaveLength(12);
    expect(window.hasNext).toBe(false);
    expect(window).toMatchObject({ first: LISTING_PAGE_SIZE + 1, last: LISTING_PAGE_SIZE + 12 });
  });

  it("shows nothing and numbers nothing for a page past the end", () => {
    expect(pageWindow([], 4)).toEqual({ items: [], hasNext: false, first: 0, last: 3 * LISTING_PAGE_SIZE });
  });

  it("never shows more than a page, whatever the server returns", () => {
    expect(pageWindow(rows(100), 1).items).toHaveLength(LISTING_PAGE_SIZE);
  });

  it("covers every row exactly once across all pages", () => {
    const all = rows(60);
    const seen: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      seen.push(...pageWindow(all.slice((page - 1) * LISTING_PAGE_SIZE), page).items);
    }
    expect(seen).toEqual(all);
  });
});
