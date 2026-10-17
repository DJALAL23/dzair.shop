/**
 * The platform owns the paths of its page types (`STOREFRONT_PAGE_PATHS` in
 * `@wocart/storefront`): the dashboard, the server and the ad tools build the
 * same links without running this theme. So the theme builds every link to a
 * product, a category, a store page, a landing page, the catalog or the
 * checkout with `storefrontPath`, never by hand — a hand-written path drifts,
 * and skips the encoding a handle with a space or an accent needs.
 */
import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

const HAND_WRITTEN = [
  /`\/(products|category|pages|lp)\/\$\{/,
  /href\(\s*["'`]\/(products|checkout|thank-you)["'`]\s*\)/,
];

describe("links to the platform's page types", () => {
  it("are built with storefrontPath, never written by hand", () => {
    const offenders = themeSourceFiles().flatMap((file) =>
      file.content
        .split("\n")
        .map((line, index) => ({ line, at: `${file.relPath}:${index + 1}` }))
        .filter(({ line }) => !/^\s*(\/\/|\/?\*)/.test(line) && HAND_WRITTEN.some((pattern) => pattern.test(line)))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
