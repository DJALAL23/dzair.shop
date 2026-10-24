/**
 * A link to something that no longer exists answers a real 404.
 *
 * Each page type that names one resource (a product, a category, a store page,
 * a landing page) looks it up in its route, before anything is streamed, and
 * answers the SDK's `notFound(Astro)` when it is missing — the 404 page, never
 * cached, so a product published a minute later shows. A redirect to the home page,
 * or a lookup inside a streamed component, answers 200 instead: a "soft 404"
 * for search engines and ad reviews.
 */
import { describe, expect, it } from "vitest";
import { type SourceFile, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();
const route = (rel: string) => files.find((file) => file.relPath === rel);

describe("missing resources answer 404", () => {
  for (const rel of ["pages/products/[slug].astro", "pages/category/[slug].astro", "pages/collections/[handle].astro", "pages/pages/[slug].astro", "pages/lp/[slug].astro"]) {
    it(`${rel} answers a missing resource with the SDK's notFound`, () => {
      const file = route(rel);
      expect(file, rel).toBeDefined();
      expect(file!.content).toMatch(/if \(!\w+\) return notFound\(Astro\);/);
    });
  }

  it("no page rolls its own not-found: a rewrite keeps the route's cache rule", () => {
    const handRolled = files.filter((file) => file.relPath.startsWith("pages/") && file.relPath !== "pages/404.astro" && /rewrite\(["']\/404["']\)|cache\.set\(false\)/.test(file.content));
    expect(handRolled.map((file) => file.relPath)).toEqual([]);
  });

  it("no component answers a missing resource itself (too late: the status is already sent)", () => {
    const late = files.filter((file) => file.relPath.startsWith("theme/components/") && /return Astro\.(rewrite|redirect)\(/.test(file.content));
    expect(late.map((file) => file.relPath)).toEqual([]);
  });
});
