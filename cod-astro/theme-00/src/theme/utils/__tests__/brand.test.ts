import { describe, expect, it } from "vitest";
import { safeHex } from "../brand";

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
