import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { money } from "./money";

describe("money", () => {
  it("writes dinars as an exact two-decimal string in DZD", () => {
    expect(money(1500)).toEqual({ amount: "1500.00", currency: "DZD" });
    expect(money(0)).toEqual({ amount: "0.00", currency: "DZD" });
    expect(money(99.5)).toEqual({ amount: "99.50", currency: "DZD" });
  });

  it("rounds a stored float to the centime", () => {
    expect(money(0.1 + 0.2).amount).toBe("0.30");
    expect(money(1234.006).amount).toBe("1234.01");
    expect(money(10.004).amount).toBe("10.00");
  });

  it("refuses what is not an amount", () => {
    for (const bad of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => money(bad)).toThrow(RangeError);
    }
  });

  it("always reads back as the same number to the centime", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_00 }), (centimes) => {
        const { amount } = money(centimes / 100);
        expect(amount).toMatch(/^\d+\.\d{2}$/);
        expect(Math.round(Number(amount) * 100)).toBe(centimes);
      }),
    );
  });
});
