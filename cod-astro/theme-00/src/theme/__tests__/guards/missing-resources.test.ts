/**
 * A link to something that no longer exists answers a real 404.
 *
 * Each page type that names one resource (a product, a category, a store page,
 * a landing page) looks it up in its route, before anything is streamed, and
 * rewrites to the 404 page when it is missing. A redirect to the home page,
 * or a lookup inside a streamed component, answers 200 instead: a "soft 404"
 * for search engines and ad reviews.
 */
import { describe, expect, it } from "vitest";
import { type SourceFile, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();
const route = (rel: string) => files.find((file) => file.relPath === rel);

describe("missing resources answer 404", () => {
  for (const rel of ["pages/products/[slug].astro", "pages/category/[slug].astro", "pages/pages/[slug].astro", "pages/lp/[slug].astro"]) {
    it(`${rel} rewrites a missing resource to the 404 page`, () => {
      const file = route(rel);
      expect(file, rel).toBeDefined();
      expect(file!.content).toMatch(/if \(!\w+\) return Astro\.rewrite\("\/404"\);/);
    });
  }

  it("no component answers a missing resource itself (too late: the status is already sent)", () => {
    const late = files.filter((file) => file.relPath.startsWith("theme/components/") && /return Astro\.(rewrite|redirect)\(/.test(file.content));
    expect(late.map((file) => file.relPath)).toEqual([]);
  });
});
