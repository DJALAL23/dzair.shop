/**
 * Placeholders and plurals go through ONE binding (`content/messages.ts`).
 * Hand-rolled `.replace("{n}", …)` fills only the first occurrence, skips the
 * language's number format and cannot pick a plural form — it is how
 * "1 منتجات" shipped.
 */
import { describe, expect, it } from "vitest";
import { type SourceFile, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();

describe("messages — one binding for placeholders and plurals", () => {
  it("scans the source tree (a broken walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no source fills a placeholder by hand", () => {
    const offenders = files
      .filter((file) => /\.replace\(\s*["'`]\{\w+\}["'`]/.test(file.content))
      .map((file) => file.relPath);
    expect(offenders).toEqual([]);
  });
});
