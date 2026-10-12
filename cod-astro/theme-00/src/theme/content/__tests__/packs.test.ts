/**
 * The three locale packs are ONE contract.
 *
 * `StoreFrontContent` already makes a *missing* key a compile error, but nothing
 * states the invariant out loud: that `ar`, `en` and `fr` declare the same keys,
 * in the same order, with a real string for every one. The three files are
 * written line-parallel on purpose — same group comments on the same line
 * numbers — so `diff ar.ts fr.ts` shows only translations.
 *
 * This guard is what keeps that property true, and it is the invariant the
 * per-area content split must preserve (see the theme-00 content slice).
 */
import { describe, expect, it } from "vitest";
import { ar } from "../ar";
import { en } from "../en";
import { fr } from "../fr";

type Pack = Record<string, string>;

const packs: Array<readonly [string, Pack]> = [
  ["ar", ar],
  ["en", en],
  ["fr", fr],
];

/** The Arabic pack is the documented fallback, so it is the reference. */
const referenceKeys = Object.keys(ar);

describe("content packs — one contract across locales", () => {
  it("is not vacuously empty (a broken import must not pass)", () => {
    expect(referenceKeys.length).toBeGreaterThan(150);
  });

  it("declares the same keys, in the same order, in every locale", () => {
    for (const [name, pack] of packs) {
      expect(Object.keys(pack), `${name}: key set and order`).toEqual(referenceKeys);
    }
  });

  it("declares every key exactly once", () => {
    expect(new Set(referenceKeys).size).toBe(referenceKeys.length);
  });

  it("carries a non-empty string for every key in every locale", () => {
    for (const [name, pack] of packs) {
      const bad = referenceKeys.filter((key) => {
        const value = pack[key];
        return typeof value !== "string" || value.trim().length === 0;
      });
      expect(bad, `${name}: empty or non-string values`).toEqual([]);
    }
  });
});