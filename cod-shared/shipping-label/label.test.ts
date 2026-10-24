import { describe, expect, it } from "vitest";
import { LABEL_WORDS, formatLabelAmount, formatLabelPhone, moreItems, placeName } from "./label";

describe("what a label prints", () => {
  it("writes amounts with Latin digits grouped by thousands, in either language", () => {
    expect(formatLabelAmount(3700, "DA")).toBe("3 700 DA");
    expect(formatLabelAmount(1250000.4, "DA")).toBe("1 250 000 DA");
    expect(formatLabelAmount(0, "دج")).toBe("0 دج");
  });

  it("groups an Algerian mobile for reading aloud, and leaves other numbers as written", () => {
    expect(formatLabelPhone("0551234567")).toBe("0551 23 45 67");
    expect(formatLabelPhone("0551 234 567")).toBe("0551 23 45 67");
    expect(formatLabelPhone("023 45 67 89")).toBe("023 45 67 89");
    expect(formatLabelPhone("+213551234567")).toBe("+213551234567");
  });

  it("counts the items it had no room for", () => {
    expect(moreItems(1, "fr")).toBe("+ 1 autre article");
    expect(moreItems(3, "fr")).toBe("+ 3 autres articles");
    expect([1, 2, 3, 11].map((n) => moreItems(n, "ar"))).toEqual(["+ منتج آخر", "+ منتجان آخران", "+ 3 منتجات أخرى", "+ 11 منتجًا آخر"]);
  });

  it("names places in the label's language", () => {
    const place = { name: "Alger", nameAr: "الجزائر" };
    expect(placeName(place, "fr")).toBe("Alger");
    expect(placeName(place, "ar")).toBe("الجزائر");
    expect(placeName(null, "ar")).toBeNull();
  });

  it("has every word in both languages", () => {
    expect(Object.keys(LABEL_WORDS.ar).sort()).toEqual(Object.keys(LABEL_WORDS.fr).sort());
    for (const words of Object.values(LABEL_WORDS)) for (const word of Object.values(words)) expect(word.trim()).not.toBe("");
  });
});
