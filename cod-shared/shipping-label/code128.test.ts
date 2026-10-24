import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, encodeCode128 } from "./code128";

/** Reads the bars back into text: the encoder's output must decode to its input, check digit included. */
function decode(widths: readonly number[]): string {
  const patterns = new Map(CODE128_PATTERNS.map((pattern, value) => [pattern, value]));
  const symbols: number[] = [];
  let at = 0;
  while (at < widths.length) {
    const size = widths.length - at === 7 ? 7 : 6;
    const value = patterns.get(widths.slice(at, at + size).join(""));
    if (value === undefined) throw new Error(`no symbol at ${at}`);
    symbols.push(value);
    at += size;
  }
  const [start, ...rest] = symbols;
  const stop = rest.pop();
  const check = rest.pop()!;
  expect(stop).toBe(106);
  expect(check).toBe((start + rest.reduce((sum, value, i) => sum + value * (i + 1), 0)) % 103);

  let set = start === 105 ? "C" : start === 104 ? "B" : "A";
  let text = "";
  for (const value of rest) {
    if (value === 99) set = "C";
    else if (value === 100) set = "B";
    else if (set === "C") text += String(value).padStart(2, "0");
    else text += String.fromCharCode(value + 32);
  }
  return text;
}

describe("Code 128", () => {
  it("has 107 distinct symbols of 11 modules, and a stop of 13", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((pattern, value) => {
      const modules = [...pattern].reduce((sum, digit) => sum + Number(digit), 0);
      expect(modules).toBe(value === 106 ? 13 : 11);
    });
  });

  it.each(["ORD-20261024-4730", "ORD-1", "A", "12", "1234", "12345", "9552", "Ab-cd_EF.gh 0123456789", " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"])(
    "encodes %j so that it reads back",
    (text) => {
      expect(decode(encodeCode128(text).widths)).toBe(text);
    },
  );

  it("packs runs of four digits or more two to a symbol", () => {
    const symbols = (text: string) => (encodeCode128(text).widths.length - 7) / 6;
    expect(symbols("ORD-20261024-4730")).toBeLessThan(17 + 2);
    expect(symbols("12345678")).toBe(1 + 4 + 1);
    expect(symbols("ORD-1")).toBe(1 + 5 + 1);
  });

  it("starts and ends with a bar, and counts the modules it draws", () => {
    const { widths, modules } = encodeCode128("ORD-20261024-4730");
    expect(widths.length % 2).toBe(1);
    expect(modules).toBe(widths.reduce((sum, w) => sum + w, 0));
  });

  it("refuses what Code 128 B cannot carry", () => {
    expect(() => encodeCode128("")).toThrow();
    expect(() => encodeCode128("طلب")).toThrow();
    expect(() => encodeCode128("café")).toThrow();
  });
});
