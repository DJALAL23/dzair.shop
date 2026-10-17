import { describe, expect, it } from "vitest";
import { brandInk, contrast, INK, onColor, PAPER, safeHex, themeFont } from "../brand";
import themeFonts from "../../fonts.json";

describe("safeHex", () => {
  it("keeps a valid hex and lowercases it", () => {
    expect(safeHex("#0B3BBD", "#000000")).toBe("#0b3bbd");
    expect(safeHex("#fff", "#000000")).toBe("#fff");
  });

  it("falls back on anything that is not a 3- or 6-digit hex", () => {
    for (const value of ["red", "#12345", "#1234567", "url(x)", "", null, undefined, "#0b3bbd; color: red"]) {
      expect(safeHex(value, "#123456")).toBe("#123456");
    }
  });
});

describe("contrast", () => {
  it("is 21 between black and white and symmetric", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("is 1 for the same color", () => {
    expect(contrast("#0b3bbd", "#0b3bbd")).toBeCloseTo(1, 5);
  });
});

describe("onColor", () => {
  it("puts paper on a dark brand color and ink on a light one", () => {
    expect(onColor("#0b3bbd")).toBe(PAPER);
    expect(onColor("#111111")).toBe(PAPER);
    expect(onColor("#f5d64c")).toBe(INK);
    expect(onColor("#ffffff")).toBe(INK);
  });

  it("always returns the more readable of the two", () => {
    for (const hex of ["#7c3aed", "#059669", "#ea580c", "#06b6d4", "#fbbf24", "#888888"]) {
      const chosen = onColor(hex);
      const other = chosen === PAPER ? INK : PAPER;
      expect(contrast(hex, chosen)).toBeGreaterThanOrEqual(contrast(hex, other));
    }
  });
});

describe("brandInk", () => {
  it("keeps a brand color that already reads on paper", () => {
    expect(brandInk("#0b3bbd")).toBe("#0b3bbd");
  });

  it("darkens a light brand color until it reaches 4.5:1 on paper", () => {
    for (const hex of ["#fbbf24", "#06b6d4", "#f5d64c", "#a7f3d0"]) {
      const ink = brandInk(hex);
      expect(ink).not.toBe(hex);
      expect(contrast(ink, PAPER)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("themeFont", () => {
  const DEFAULT = themeFonts.find((font) => font.default)!;

  it("gives the face the font setting names, with the variable Astro registered it under", () => {
    for (const font of themeFonts) expect(themeFont(font.family)).toEqual({ family: font.family, cssVariable: font.cssVariable });
  });

  it("renders a name the theme does not ship in its default face, never loading it", () => {
    for (const name of ["Cairo", "", "x&family=evil", "<script>"]) expect(themeFont(name).family).toBe(DEFAULT.family);
  });

  it("ships one default face, each under its own variable", () => {
    expect(themeFonts.filter((font) => font.default)).toHaveLength(1);
    const variables = themeFonts.map((font) => font.cssVariable);
    expect(new Set(variables).size).toBe(variables.length);
    for (const variable of variables) expect(variable).toMatch(/^--font-[a-z0-9-]+$/);
  });
});
