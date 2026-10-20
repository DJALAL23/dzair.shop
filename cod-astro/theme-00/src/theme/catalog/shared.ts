/**
 * The Home catalog's shared facts (Phase 5, slice 15; split out of `theme.ts`).
 *
 * Two theme-owned facts live here because more than one section definition
 * needs them:
 *
 * - **The read keys.** `catalog.products` / `catalog.categories` are shared by
 *   every section that needs them, through the renderer's per-render `reads`
 *   cache — the "one catalog read + one category read per render" invariant
 *   this page had before adsorption, now enforced by construction.
 * - **The copy bridge.** The pack-consuming components (hero, how-it-works,
 *   features-bar, whatsapp-cta, testimonials) read `content.*` from the whole
 *   pack object, while the contract resolves copy per field
 *   (`contentKey`, slice 07 §4). `copyOverrides` overlays the resolved fields
 *   back over the pack: with no stored props it is a no-op (pack parity);
 *   with a stored prop the instance value wins.
 */

import type { FieldDefinition, StyleValue } from "@wocart/theme";
import { PAGE_SCHEME, type SchemeId } from "../appearance";
import { FIELD, OPTION } from "./labels";

export const CATALOG_READ = "catalog.products";
export const CATEGORIES_READ = "catalog.categories";
/** One collection's products, up to a count: sections showing the same list share the read. */
export const collectionRead = (handle: string, limit: number) => `catalog.collection:${handle}:${limit}`;
/** The products on sale, up to a count. */
export const onSaleRead = (limit: number) => `catalog.on-sale:${limit}`;

/**
 * The resolved copy fields over the pack. Only string values whose key is a
 * real pack key are overlaid; everything else (e.g. `enabled`) travels as its
 * own prop.
 */
export function copyOverrides(
  content: Record<string, string>,
  props: Record<string, unknown>,
): Record<string, string> {
  const merged: Record<string, string> = { ...content };
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string" && Object.hasOwn(merged, key)) {
      merged[key] = value;
    }
  }
  return merged;
}
/** The pages a store composes; a section names the ones it serves. */
export const PAGE_SURFACES = ["home", "product", "collection", "category", "catalog", "page"] as const;
export const HEADER_AREA = "area:header";
export const FOOTER_AREA = "area:footer";

/**
 * The spacing a section starts with: room above and below, more on a wide
 * screen. A band of its own color (`banded`) needs more room inside it than a
 * section sharing the page's color.
 */
export function sectionSpacing(banded = false): StyleValue {
  return banded
    ? { spacing: { paddingBlockStart: { base: "s8", lg: "s10" }, paddingBlockEnd: { base: "s8", lg: "s10" } }, size: { width: { base: "wide" } } }
    : { spacing: { paddingBlockStart: { base: "s6", lg: "s8" }, paddingBlockEnd: { base: "s6", lg: "s8" } }, size: { width: { base: "wide" } } };
}

/** Which of the store's color schemes a section or block wears. */
export const schemeField = (fallback: SchemeId = PAGE_SCHEME) =>
  ({ key: "scheme", kind: "colorScheme", label: FIELD.scheme, default: fallback }) as const satisfies FieldDefinition;

/** A section's room above and below, and how wide its content runs. */
export const styleField = (fallback: StyleValue = sectionSpacing()) =>
  ({ key: "style", kind: "style", label: FIELD.style, panels: ["spacing", "size"], default: fallback }) as const satisfies FieldDefinition;

/** How a section of products lays them out: a grid, or a row a phone swipes; how many across on a wide screen; a link to all of them. */
export const productGridFields = [
  {
    key: "headingAlign",
    kind: "select",
    label: FIELD.headingAlign,
    options: ["start", "center"],
    optionLabels: { start: OPTION.start, center: OPTION.center },
    default: "center",
    display: "segmented",
  },
  {
    key: "layout",
    kind: "select",
    label: FIELD.layout,
    options: ["grid", "carousel"],
    optionLabels: { grid: OPTION.grid, carousel: OPTION.carousel },
    default: "grid",
    display: "segmented",
  },
  { key: "columns", kind: "number", label: FIELD.columns, min: 2, max: 5, step: 1, default: 4, display: "slider" },
  { key: "showViewAll", kind: "boolean", label: FIELD.showViewAll, default: true },
] as const satisfies readonly FieldDefinition[];
