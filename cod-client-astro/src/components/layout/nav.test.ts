import { describe, expect, it } from "vitest";
import { isCurrentPath } from "./nav";

describe("the current page in the navigation", () => {
  it("reads a path with a trailing slash like the same path without it", () => {
    expect(isCurrentPath("/orders/abandoned/", "/orders")).toBe(false);
    expect(isCurrentPath("/orders/spam/", "/orders")).toBe(false);
    expect(isCurrentPath("/orders/spam/", "/orders/spam")).toBe(true);
    expect(isCurrentPath("/orders/abandoned/", "/orders/abandoned")).toBe(true);
    expect(isCurrentPath("/products/stock/", "/products")).toBe(false);
    expect(isCurrentPath("/products/stock/", "/products/stock")).toBe(true);
    expect(isCurrentPath("/customers/", "/customers")).toBe(true);
    expect(isCurrentPath("/orders/", "/orders")).toBe(true);
  });

  it("lights a section for its own pages and nothing else", () => {
    expect(isCurrentPath("/orders/ord_1", "/orders")).toBe(true);
    expect(isCurrentPath("/orders/abandoned", "/orders")).toBe(false);
    expect(isCurrentPath("/customer-groups", "/customers")).toBe(false);
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/dashboard/", "/")).toBe(false);
  });
});
