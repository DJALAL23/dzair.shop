// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Each route renders from its own catalog (`catalog/families/*`), so a page
 * carries the sections it can show and nothing else. These tests hold the split
 * to the placement rules each definition declares (`capabilities.surfaces`):
 * a catalog holds every section allowed on its surfaces, nothing a surface
 * refuses, and every section a shipped document places.
 */
import { describe, expect, it } from "vitest";
import { isInsertableOn, type ComponentDefinition, type PageData, type ThemeDefinition } from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import { homeCatalog } from "@/theme/catalog/families/home";
import { productCatalog } from "@/theme/catalog/families/product";
import { listingCatalog } from "@/theme/catalog/families/listing";
import { pageCatalog } from "@/theme/catalog/families/page";
import { thankYouCatalog } from "@/theme/catalog/families/thank-you";
import { landingCatalog } from "@/theme/catalog/families/landing";
import { searchCatalog } from "@/theme/catalog/families/search";
import { trackOrderCatalog } from "@/theme/catalog/families/track-order";
import { checkoutCatalog } from "@/theme/catalog/families/checkout";
import { contactCatalog } from "@/theme/catalog/families/contact";
import { shellCatalog } from "@/theme/catalog/families/shell";

const families: Array<{ name: string; catalog: ThemeDefinition; surfaces: string[] }> = [
  { name: "home", catalog: homeCatalog, surfaces: ["home"] },
  { name: "product", catalog: productCatalog, surfaces: ["product"] },
  { name: "listing", catalog: listingCatalog, surfaces: ["collection", "category", "catalog"] },
  { name: "page", catalog: pageCatalog, surfaces: ["page"] },
  { name: "thank-you", catalog: thankYouCatalog, surfaces: ["thank-you"] },
  { name: "landing", catalog: landingCatalog, surfaces: ["landing"] },
  { name: "search", catalog: searchCatalog, surfaces: ["search"] },
  { name: "track-order", catalog: trackOrderCatalog, surfaces: ["track-order"] },
  { name: "checkout", catalog: checkoutCatalog, surfaces: ["checkout"] },
  { name: "contact", catalog: contactCatalog, surfaces: ["contact"] },
  { name: "shell", catalog: shellCatalog, surfaces: ["area:header", "area:footer"] },
];

const components = theme00.components as Record<string, ComponentDefinition>;

/**
 * Whether a surface may hold a section. An editor's insertability is a separate
 * rule: a required section (the product page's own) is placed by its document.
 */
const inScope = (definition: ComponentDefinition, surface: string) =>
  isInsertableOn({ ...definition, capabilities: { ...definition.capabilities, insertable: true } }, surface);

/** The sections a document places, including those its fixed and required blocks name. */
function typesIn(node: unknown, found = new Set<string>()): Set<string> {
  if (node === null || typeof node !== "object") return found;
  const type = (node as { type?: unknown }).type;
  if (typeof type === "string") found.add(type);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => typesIn(child, found));
    else if (value !== null && typeof value === "object") typesIn(value, found);
  }
  return found;
}

describe("route catalogs", () => {
  it.each(families)("$name holds every section its surfaces allow, and nothing they refuse", ({ catalog, surfaces }) => {
    const allowed = Object.keys(components).filter((type) => surfaces.some((surface) => inScope(components[type]!, surface)));
    const held = Object.keys(catalog.components);
    expect(allowed.filter((type) => !held.includes(type))).toEqual([]);
    for (const type of held) {
      const refused = surfaces.every((surface) => !inScope(components[type]!, surface));
      expect(refused && !allowed.includes(type), type).toBe(false);
    }
  });

  it("the route catalogs together are the full catalog: same components, surfaces and areas", () => {
    const union = new Set(families.flatMap(({ catalog }) => Object.keys(catalog.components)));
    expect([...union].sort()).toEqual(Object.keys(theme00.components).sort());
    const surfaces = families.flatMap(({ catalog }) => (catalog.surfaces ?? []).map((surface) => surface.key));
    expect(surfaces.sort()).toEqual(theme00.surfaces.map((surface) => surface.key).sort());
    expect((shellCatalog.areas ?? []).map((area) => area.key).sort()).toEqual((theme00.areas ?? []).map((area) => area.key).sort());
  });

  it("each route catalog declares exactly its own surfaces", () => {
    for (const { catalog, surfaces } of families) {
      const declared = [...(catalog.surfaces ?? []).map((surface) => surface.key), ...(catalog.areas ?? []).map((area) => `area:${area.key}`)];
      expect(declared.sort()).toEqual(surfaces.sort());
    }
  });
});

describe("shipped documents", () => {
  const documents = [
    ...theme00.surfaces.map((surface) => ({ surface: surface.key, document: surface.document as PageData | undefined })),
    ...(theme00.areas ?? []).map((area) => ({ surface: `area:${area.key}`, document: area.document as PageData | undefined })),
  ];

  it.each(documents)("$surface places only sections its surface allows, all held by its catalog", ({ surface, document }) => {
    const family = families.find((candidate) => candidate.surfaces.includes(surface));
    expect(family, surface).toBeDefined();
    for (const type of typesIn(document)) {
      const definition = components[type];
      expect(definition, `${surface} places an unknown "${type}"`).toBeDefined();
      expect(inScope(definition!, surface), `${surface} places "${type}", which its surface refuses`).toBe(true);
      expect(Object.keys(family!.catalog.components), `${surface} places "${type}" its catalog does not hold`).toContain(type);
    }
  });
});
