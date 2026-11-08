import { describe, expect, it } from "vitest";
import { amount, deliveryPrice } from "./price";

describe("carrier amounts", () => {
  it("reads numbers and numeric strings as DZD", () => {
    expect(amount(500)).toBe(500);
    expect(amount("1300")).toBe(1300);
    expect(amount("100.00")).toBe(100);
    expect(amount(0)).toBe(0);
  });

  it("is null for what is not an amount", () => {
    for (const v of [null, undefined, "", " ", "abc", -1, Number.NaN, {}]) expect(amount(v)).toBeNull();
  });

  it("reads a delivery price of 0 as no price, and keeps a free return as 0", () => {
    expect(deliveryPrice("0")).toBeNull();
    expect(deliveryPrice(0)).toBeNull();
    expect(deliveryPrice("350")).toBe(350);
    expect(amount("0")).toBe(0);
  });
});
