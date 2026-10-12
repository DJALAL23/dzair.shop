/**
 * Server-island payload budget (S1).
 *
 * Astro encrypts server-island props into the island request URL. The browser
 * caps URLs at 2048 bytes; past the cap Astro switches to a POST, and
 * "POST requests are not cached by browsers… Therefore, any existing caching
 * logic in your project will break" (docs.astro.build → Server islands →
 * Caching). The docs' own advice is to "pass only necessary props to your
 * server islands and avoid sending entire data objects and arrays".
 *
 * The theme's pages are edge-cached (routeRules in astro.config.mjs), so both
 * islands must stay on the GET path. These tests pin both halves of that
 * contract: the pack is too big, and every island's copy *pick* fits.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ar } from "../../content/ar";
import { relatedProductsCopy, reviewsIslandCopy } from "../../bridges/island-props";

/** docs.astro.build → Server islands → Caching. */
const ISLAND_GET_LIMIT_BYTES = 2048;

const component = (name: string): string =>
  readFileSync(resolve(__dirname, "../../components/product", name), "utf8");

describe("server island copy budget", () => {
  it("the full pack exceeds the island URL limit — the reason picks exist", () => {
    expect(JSON.stringify(ar).length).toBeGreaterThan(ISLAND_GET_LIMIT_BYTES);
  });

  it("every island's copy pick fits under the limit", () => {
    // Encryption and base64 add overhead on top of the JSON, so stay under.
    expect(JSON.stringify(relatedProductsCopy(ar)).length).toBeLessThan(
      ISLAND_GET_LIMIT_BYTES,
    );
    expect(JSON.stringify(reviewsIslandCopy(ar)).length).toBeLessThan(
      ISLAND_GET_LIMIT_BYTES,
    );
  });

  it("island components take a pick, never the pack", () => {
    for (const name of ["RelatedProducts.astro", "ReviewsIsland.astro"]) {
      const source = component(name);
      expect(source, name).not.toContain("StoreFrontContent");
      // They render through the pick, not through a `content` object.
      expect(source, name).not.toContain("content.");
    }
  });

  it("the reviews list ships one label to its inline script, not the pack", () => {
    const source = component("ReviewsList.astro");

    expect(source).not.toContain("define:vars={{ content }}");
    expect(source).toContain("loadMoreLabel");
  });

  it("ShippingIsland takes no props (nothing to encrypt)", () => {
    expect(component("ShippingIsland.astro")).not.toContain("interface Props");
  });
});
