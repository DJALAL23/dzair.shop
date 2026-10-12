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

export const CATALOG_READ = "catalog.products";
export const CATEGORIES_READ = "catalog.categories";

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