import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { metaBrowserId, metaClickId } from "./meta-ids";

describe("metaClickId", () => {
  it("keeps the values Meta documents", () => {
    for (const value of [
      "fb.1.1554763741205.IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk",
      "fb.1.1554763741205.AbCdEfGhIjKlMnOpQrStUvWxYz1234567890.ABcDEFGh",
      "fb.0.1709136167115.IwAR2F4",
      "fb.2.1709136167115.IwAR2F4.Ag",
    ]) expect(metaClickId(value), value).toBe(value);
  });

  it("trims the whitespace a cookie read can carry", () => {
    expect(metaClickId("  fb.1.1709136167115.IwAR2F4 ")).toBe("fb.1.1709136167115.IwAR2F4");
  });

  it("drops what Meta would silently fail to match", () => {
    for (const value of [
      "IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB",
      "fb.1.1700000000.abc",
      "fb.3.1709136167115.IwAR2F4",
      "fb.1.1709136167115.",
      "fb.1.1709136167115.Iw AR",
      "fb.1.1709136167115.IwAR<script>",
      "fbc.1.1709136167115.IwAR2F4",
      "fb.1.1709136167115.IwAR2F4.",
      "undefined",
      "",
      "   ",
      `fb.1.1709136167115.${"a".repeat(500)}`,
    ]) expect(metaClickId(value), value).toBeNull();
  });

  it("drops anything that is not a string", () => {
    for (const value of [undefined, null, 1709136167115, {}, ["fb.1.1709136167115.IwAR2F4"]]) expect(metaClickId(value)).toBeNull();
  });

  it("keeps every well-formed click id it is given", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("0", "1", "2"),
        fc.integer({ min: 1_000_000_000_000, max: 9_999_999_999_999 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{1,200}$/),
        (index, created, fbclid) => {
          const value = `fb.${index}.${created}.${fbclid}`;
          return metaClickId(value) === value;
        },
      ),
    );
  });
});

describe("metaBrowserId", () => {
  it("keeps the values Meta documents, with or without the Parameter Builder appendix", () => {
    for (const value of ["fb.1.1596403881668.1116446470", "fb.1.1596403881668.1116446470.ABcDEFGh", "fb.2.1596403881668.1116446470.Ag"]) {
      expect(metaBrowserId(value), value).toBe(value);
    }
  });

  it("drops what is not a browser id", () => {
    for (const value of [
      "fb.1.1700000001.123",
      "fb.1.1596403881668.abc",
      "fb.1.1596403881668.1116446470.AB.CD",
      "fb.1.1596403881668.IwAR2F4-dbP0l7Mn1",
      "1116446470",
      "fb.4.1596403881668.1116446470",
      "",
      42,
      null,
    ]) expect(metaBrowserId(value), String(value)).toBeNull();
  });
});
