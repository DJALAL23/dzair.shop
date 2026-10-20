/**
 * Product Zero guards — the boundaries this refactor established.
 *
 * `sdk-boundary.test.ts` pins the platform seam (who may import the SDK, which
 * rules live in the SDK). This file pins the theme-side structure the Product
 * Zero audit (`PRODUCT_ZERO_AUDIT.md`) requires so a future theme
 * can be built from the same evidence:
 *
 * 1. Typed props only — no `any` in theme source.
 * 2. Money is formatted in exactly one module.
 * 3. The homepage owns its data graph; sections are presentational.
 * 4. The commerce view (price/discount/stock) is derived once.
 * 5. Deleted dead code stays deleted; the deprecated import path stays dead.
 *
 * Each guard is written against what the code does now, so a correct
 * re-implementation under a different shape stays green — it goes red when the
 * rule itself is undone.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { type SourceFile, SRC_DIR, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();

const find = (relPath: string) => files.find((f) => f.relPath === relPath);

describe("Product Zero — typed props", () => {
  it("scans the source tree (a broken walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no theme source declares `any`", () => {
    const offenders = files
      .filter((f) => /:\s*any\b/.test(f.content))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("the product card requires its copy pick (no language-specific fallback)", () => {
    const card = find("theme/components/product/ProductCard.astro");

    expect(card?.content).toContain("copy: ProductCardCopy");
    // An optional pack is how "اطلب الآن" got hardcoded into a shared card.
    expect(card?.content).not.toContain("content?:");
  });
});

describe("Product Zero — one money formatter", () => {
  it("money is formatted in exactly one theme module", () => {
    const offenders = files
      .filter((f) => f.content.includes("toLocaleString("))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual(["theme/utils/money.ts"]);
  });

  it("that module builds on the SDK's formatter", () => {
    const money = find("theme/utils/money.ts");

    expect(money?.content).toContain("formatMoney");
    expect(money?.content).toContain('from "@wocart/storefront"');
  });

  it("does not bypass the theme money binding", () => {
    const offenders = files
      .filter((f) => f.relPath !== "theme/utils/money.ts" && f.content.includes("formatMoney"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("no component or script keeps a local fmt() helper", () => {
    const offenders = files
      .filter((f) => /function fmt\(|const fmt\s*=/.test(f.content))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe("Product Zero — the homepage owns its data graph", () => {
  const countIn = (content: string, needle: string) =>
    content.split(needle).length - 1;

  it("reads the catalog and categories exactly once each", () => {
    const page = find("theme/pages/HomeSurface.astro");
    const sections = find("theme/components/surface/Sections.astro");
    const definitions = files
      .filter((f) => f.relPath.startsWith("theme/catalog/"))
      .map((f) => f.content)
      .join("\n");

    // The reads live in the per-section definitions under `theme/catalog/`,
    // never in a page. A composed page renders through `Sections.astro`,
    // which owns ONE `reads` cache; the shared keys live in
    // `theme/catalog/shared.ts`; every consumer behind a key collapses to one
    // request per render — proven behaviorally in
    // `__tests__/contracts/home-adsorption.test.ts`.
    for (const owner of [page, sections]) {
      expect(countIn(owner?.content ?? "", "products.list(")).toBe(0);
      expect(countIn(owner?.content ?? "", "categories.list(")).toBe(0);
    }
    expect(countIn(sections?.content ?? "", "createReadCache(")).toBe(1);

    // Two sections name the catalog key — category cards and the
    // testimonials' product lookup — five read the collection their setting
    // names under its own key (hero, featured products, best sellers, new
    // arrivals, a product tab), and three read the products on sale (on
    // sale, a product tab, the promotion banner's photo), and two the
    // categories (category cards, and a listing's category buttons). The
    // renderer's read cache runs each loader once per render.
    expect(countIn(definitions, "reads.get(CATALOG_READ")).toBe(2);
    expect(countIn(definitions, "reads.get(collectionRead(")).toBe(5);
    expect(countIn(definitions, "reads.get(onSaleRead(")).toBe(3);
    expect(countIn(definitions, "reads.get(CATEGORIES_READ")).toBe(2);
  });

  it("no home section reads the catalog or categories", () => {
    const offenders = files
      .filter(
        (f) =>
          f.relPath.startsWith("theme/components/home/") &&
          /products\.list\(|categories\.list\(/.test(f.content),
      )
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe("Product Zero — one commerce view", () => {
  it("the SDK owns low-stock threshold derivation", () => {
    const hardcoded = files
      .filter((f) => /inventory\s*<=\s*5\b/.test(f.content))
      .map((f) => f.relPath)
      .sort();
    expect(hardcoded).toEqual([]);

    const localReaders = files
      .filter((f) => f.content.includes("lowStockThreshold"))
      .map((f) => f.relPath)
      .sort();
    expect(localReaders).toEqual([]);
    expect(find("theme/utils/product-view.ts")).toBeUndefined();
  });

  it("the theme does not re-derive the default variant", () => {
    const localPickers = files
      .filter((f) => f.content.includes("v.isDefault"))
      .map((f) => f.relPath)
      .sort();

    expect(localPickers).toEqual([]);
    const card = find("theme/components/product/ProductCard.astro")?.content ?? "";
    expect(card).toContain('import { getProductListView, getProductView, type Product, type ProductList } from "@wocart/storefront"');
    expect(card).toContain('"variants" in product ? getProductView(product) : getProductListView(product)');
  });
});

describe("Product Zero — dead code stays deleted", () => {
  it("the unreferenced components and shims are gone", () => {
    const deleted = [
      "theme/components/home/FeaturedProducts.astro",
      "theme/components/home/CategoryBar.astro",
      "theme/components/home/CategoryBarWithData.astro",
      "theme/components/home/TopAnnouncementBanner.astro",
      "theme/scripts/product/types.ts",
      "theme/config/content.ts",
    ];

    for (const relPath of deleted) {
      expect(existsSync(join(SRC_DIR, relPath)), `${relPath} is back`).toBe(false);
    }
  });

  it("nothing imports the deleted deprecated content path", () => {
    const offenders = files
      .filter((f) => f.content.includes("@/theme/config/content"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("the page-data bridge id is defined in exactly one module", () => {
    const definers = files
      .filter((f) => f.content.includes('"page-data"'))
      .map((f) => f.relPath)
      .sort();

    expect(definers).toEqual(["theme/bridges/product-page-data.ts"]);
  });
});

describe("Product Zero — script copy", () => {
  it("browser scripts carry no shopper-facing copy — the markup does", () => {
    // Scripts run under whatever language the store is set to; a literal in
    // one language is silent breakage in the other two. Copy reaches a script
    // only through the DOM (bridge, data-strings, element text).
    const arabic = /[\u0600-\u06FF]/;
    const offenders = files
      .filter((f) => f.relPath.startsWith("theme/scripts/") && arabic.test(f.content))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });
});
