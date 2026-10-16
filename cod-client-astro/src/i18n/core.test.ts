import { describe, it, expect } from "vitest";
import { resolve, makeT } from "./core";

const dict = { table: { total: "Total" }, deep: { a: { b: "x" } } };

describe("resolve", () => {
  it("resolves nested dot-paths", () => expect(resolve(dict, "table.total")).toBe("Total"));
  it("resolves a leaf key that itself contains dots", () => {
    expect(resolve({ actions: { "order.created": "Created" } }, "actions.order.created")).toBe("Created");
  });
  it("returns undefined for missing paths / non-strings", () => {
    expect(resolve(dict, "table.missing")).toBeUndefined();
    expect(resolve(dict, "deep")).toBeUndefined();
  });
});

describe("makeT fallback chain", () => {
  const t = makeT({ only: "عربي" }, dict);
  it("uses locale value when present", () => expect(t("only")).toBe("عربي"));
  it("falls back to english dict", () => expect(t("table.total")).toBe("Total"));
  it("returns the raw key when both miss — gaps stay visible", () =>
    expect(t("nope.missing")).toBe("nope.missing"));
});

describe("makeT — plurals and placeholders", () => {
  const ar = {
    reviews: {
      total_zero: "لا تقييمات",
      total_one: "تقييم واحد",
      total_two: "تقييمان",
      total_few: "{count} تقييمات",
      total_many: "{count} تقييماً",
      total_other: "{count} تقييم",
    },
  };
  const en = { reviews: { total_one: "{count} review", total_other: "{count} reviews" }, greet: "{name}, {name}!" };

  it.each([
    [0, "لا تقييمات"],
    [1, "تقييم واحد"],
    [2, "تقييمان"],
    [5, "5 تقييمات"],
    [11, "11 تقييماً"],
    [100, "100 تقييم"],
  ])("Arabic %i → %s", (count, expected) => {
    expect(makeT(ar, en, "ar")("reviews.total", { count })).toBe(expected);
  });

  it("writes numbers with the language's grouping and Latin digits", () => {
    const result = makeT(ar, en, "ar")("reviews.total", { count: 1500 });
    expect(result).toBe(`${new Intl.NumberFormat("ar", { numberingSystem: "latn" }).format(1500)} تقييم`);
    expect(result).not.toMatch(/[٠-٩]/);
  });

  it("uses an explicit _zero for 0 even where CLDR has no zero form (English, French)", () => {
    const withZero = { total_zero: "No reviews yet", total_one: "{count} review", total_other: "{count} reviews" };
    expect(makeT(withZero, {}, "en")("total", { count: 0 })).toBe("No reviews yet");
    expect(makeT(withZero, {}, "en")("total", { count: 2 })).toBe("2 reviews");
    expect(makeT({ total_one: "{count} avis", total_other: "{count} avis" }, {}, "fr")("total", { count: 0 })).toBe("0 avis");
  });

  it("falls back to English forms only when the language lacks the message", () => {
    expect(makeT({}, en, "fr")("reviews.total", { count: 1 })).toBe("1 review");
    expect(makeT({}, en, "fr")("reviews.total", { count: 3 })).toBe("3 reviews");
  });

  it("fills every placeholder and keeps unknown ones visible", () => {
    expect(makeT({}, en, "en")("greet", { name: "Amel" })).toBe("Amel, Amel!");
    expect(makeT({}, { x: "{a} {b}" }, "en")("x", { a: "1" })).toBe("1 {b}");
  });

  it("leaves a key without values untouched, placeholders included", () => {
    expect(makeT({}, en, "en")("greet")).toBe("{name}, {name}!");
  });

  it("never resolves Object.prototype names as keys", () => {
    expect(makeT({}, {}, "en")("constructor")).toBe("constructor");
    expect(makeT({}, {}, "en")("toString.call")).toBe("toString.call");
  });
});
