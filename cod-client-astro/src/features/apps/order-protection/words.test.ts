import { describe, expect, it } from "vitest";
import { communeLabel, wilayaLabel } from "@/lib/places";
import { countryName, decidingFirst, listOf, ruleName } from "./words";

describe("words on an Order Protection screen", () => {
  it("names a template rule in the reader's language, and a merchant's own rule as written", () => {
    expect(ruleName({ name: "زبائن استلموا طلبًا", templateRule: "good_customer" }, "en")).toBe("Customers who received an order");
    expect(ruleName({ name: "Customers who received an order", templateRule: "good_customer" }, "fr")).toBe("Clients déjà livrés");
    expect(ruleName({ name: "Mes VIP", templateRule: null }, "ar")).toBe("Mes VIP");
  });

  it("joins a list the way each language does", () => {
    expect(listOf(["A", "B", "C"], "en")).toBe("A, B, and C");
    expect(listOf(["A", "B"], "fr")).toBe("A et B");
    expect(listOf(["A", "B"], "ar")).not.toContain(",");
  });

  it("names a country, and keeps a code it does not know", () => {
    expect(countryName("DZ", "en")).toBe("Algeria");
    expect(countryName("DZ", "fr")).toBe("Algérie");
    expect(countryName("not a code", "en")).toBe("not a code");
  });

  it("puts the match that decided first", () => {
    const block = { ruleId: "block-list:phone", name: "Block List", mode: "active", action: "spam", blockList: "phone" } as const;
    const flag = { ruleId: "f", name: "F", mode: "active", action: "flag" } as const;
    const trial = { ruleId: "t", name: "T", mode: "trial", action: "spam" } as const;
    expect(decidingFirst([flag, trial, block], "spam")).toEqual({ deciding: [block], also: [flag] });
  });
});

describe("places on a screen", () => {
  it("are named in the reader's language, from their number", () => {
    expect(wilayaLabel(16, "الجزائر", "en")).toBe("Alger");
    expect(wilayaLabel(16, "Alger", "ar")).toBe("الجزائر");
    expect(communeLabel("c-16-055", null, "fr")).toBe("Baba Hassen");
  });

  it("fall back to what was stored when the number is unknown", () => {
    expect(wilayaLabel(null, "Somewhere", "en")).toBe("Somewhere");
    expect(communeLabel("nope", "Stored", "en")).toBe("Stored");
  });
});
