/**
 * The theme's message binding over the real packs: grammatical plurals in
 * every language, this theme's Latin digits, and the browser path a script
 * takes from a `data-*` attribute.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ar } from "../ar";
import { en } from "../en";
import { fr } from "../fr";
import { embeddedMessage, embeddedTemplate, message, messageData } from "../messages";

describe("message — the real packs", () => {
  it.each([
    [1, "منتج واحد"],
    [2, "منتجان"],
    [3, "3 منتجات"],
    [11, "11 منتجاً"],
    [100, "100 منتج"],
    [1500, "1.500 منتج"],
  ])("Arabic cart count %i → %s", (count, expected) => {
    expect(message(ar, "cartItems", { count }, "ar")).toBe(expected);
  });

  it("French and English take their own forms", () => {
    expect(message(fr, "cartItems", { count: 1 }, "fr")).toBe("1 article");
    expect(message(fr, "cartItems", { count: 4 }, "fr")).toBe("4 articles");
    expect(message(en, "ariaStarRating", { count: 1 }, "en")).toBe("1 star");
    expect(message(en, "ariaStarRating", { count: 5 }, "en")).toBe("5 stars");
    expect(message(ar, "lowStock", { count: 2 }, "ar")).toBe("آخر قطعتين");
  });

  it("fills every placeholder with this theme's digits", () => {
    expect(message(ar, "offerSavingsText", { amount: "4.500", currency: "دج" }, "ar")).toBe("توفير 4.500\u00A0دج");
    expect(message(en, "ariaGoToImage", { n: 2, total: 12 }, "en")).toContain("2");
  });
});

describe("the browser path", () => {
  afterEach(() => {
    document.documentElement.lang = "";
  });

  it("formats a message carried as a data attribute, in the page's language", () => {
    document.documentElement.lang = "ar";
    expect(embeddedMessage(messageData(ar, "cartItems"), "cartItems", { count: 2 })).toBe("منتجان");
    document.documentElement.lang = "fr";
    expect(embeddedMessage(messageData(fr, "cartItems"), "cartItems", { count: 2 })).toBe("2 articles");
  });

  it("shows the key, not a blank, when the attribute is missing or malformed", () => {
    expect(embeddedMessage(undefined, "cartItems", { count: 2 })).toBe("cartItems");
    expect(embeddedMessage("{not json", "cartItems", { count: 2 })).toBe("cartItems");
  });

  it("fills a plain template carried as markup", () => {
    document.documentElement.lang = "en";
    expect(embeddedTemplate("{amount} {currency} to go", { amount: "1.000", currency: "DZD" })).toBe("1.000 DZD to go");
  });
});
