// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Every word a home section shows must be reachable by an editor.
 *
 * Copy reaches a section two ways, as on Shopify (section settings + locale
 * files): a **field** on the section's definition, editable per instance, or a
 * **shared UI label** from the store-wide pack (button verbs, aria text),
 * editable once for the whole store through the content overrides. A section
 * that renders a pack key that is neither silently freezes that text for
 * every merchant — this file makes it a test failure instead.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@codflow/theme";
import { theme00 } from "@/theme/theme";

/**
 * Labels shared across sections and pages. They are UI vocabulary, not section
 * copy, so they stay store-wide. Each entry must be rendered by some section.
 */
const SHARED_UI_LABELS = new Set([
  "viewAllCta",
  "viewProduct",
  "ariaBrowseCategoryProducts",
  "ariaStarRating",
  "reviewsVerifiedBuyer",
]);

const CATALOG_DIR = path.resolve(process.cwd(), "src/theme/catalog/home");

/** The section's component source, found through the import its definition file makes. */
function componentSourceOf(type: string): string {
  const definitionFile = readFileSync(path.join(CATALOG_DIR, `${type}.def.ts`), "utf8");
  const match = /import\s+\w+\s+from\s+"@\/(theme\/components\/[^"]+\.astro)"/.exec(definitionFile);
  if (!match) throw new Error(`${type}.def.ts does not import its component`);
  return readFileSync(path.resolve(process.cwd(), "src", match[1] as string), "utf8");
}

const sections = Object.entries(theme00.components).map(([type, definition]) => {
  const fields: readonly FieldDefinition[] = definition.fields ?? [];
  const source = componentSourceOf(type);
  const rendered = new Set([...source.matchAll(/\bcontent\.(\w+)/g)].map((m) => m[1] as string));
  const copyFields = fields.filter(
    (field): field is FieldDefinition & { contentKey: string } =>
      (field.kind === "text" || field.kind === "textarea") && field.contentKey !== undefined,
  );
  return { type, fields, source, rendered, copyFields };
});

describe("home sections expose their copy to the editor", () => {
  it("found every section's component", () => {
    expect(sections.map((s) => s.type).sort()).toEqual(Object.keys(theme00.components).sort());
  });

  it.each(sections)("$type renders only fields or shared UI labels", ({ rendered, copyFields }) => {
    const editable = new Set(copyFields.map((field) => field.contentKey));
    const frozen = [...rendered].filter((key) => !editable.has(key) && !SHARED_UI_LABELS.has(key));
    expect(frozen).toEqual([]);
  });

  it.each(sections)("$type copy fields are named after their pack key", ({ copyFields }) => {
    // `copyOverrides` overlays a resolved field onto the pack by its key.
    const renamed = copyFields.filter((field) => field.key !== field.contentKey).map((f) => f.key);
    expect(renamed).toEqual([]);
  });

  it.each(sections)("$type component reads every setting it declares", ({ fields, source }) => {
    const settings = fields.filter((field) => !("contentKey" in field && field.contentKey));
    const unused = settings
      .map((field) => field.key)
      .filter((key) => !new RegExp(`\\b${key}\\b`).test(source));
    expect(unused).toEqual([]);
  });

  it("every shared UI label is still rendered by some section", () => {
    const renderedAnywhere = new Set(sections.flatMap((s) => [...s.rendered]));
    expect([...SHARED_UI_LABELS].filter((key) => !renderedAnywhere.has(key))).toEqual([]);
  });
});
