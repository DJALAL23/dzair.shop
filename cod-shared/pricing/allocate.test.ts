import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";

describe("allocate", () => {
  it("shares in proportion, the remainder to the largest fractions, a tie to the earlier part", () => {
    expect(allocate(4000, [2, 1])).toEqual([2667, 1333]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(100, [0, 1, 1])).toEqual([0, 50, 50]);
    expect(allocate(0, [3, 4])).toEqual([0, 0]);
  });

  it("shares nothing across nothing, and refuses to share something across nothing", () => {
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocate(5, [0, 0])).toThrow(RangeError);
  });

  it("sums to the total, each share within one dinar of its exact proportion", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 10 }), (total, weights) => {
        const shares = allocate(total, weights);
        const sum = weights.reduce((acc, weight) => acc + weight, 0);
        expect(shares.reduce((acc, share) => acc + share, 0)).toBe(total);
        shares.forEach((share, index) => {
          expect(Number.isInteger(share)).toBe(true);
          expect(Math.abs(share - (total * weights[index]!) / sum)).toBeLessThan(1);
        });
      }),
    );
  });
});
