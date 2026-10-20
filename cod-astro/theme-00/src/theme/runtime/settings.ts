/**
 * The theme's settings for this request: the store's values checked against
 * the theme's declaration (`resolveThemeSettings`), resolved once per store
 * context however many components ask — the layout, every product card.
 */
import { resolveThemeSettings, type InferSettings } from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import type { StoreContext } from "./store";

export type ThemeSettings = InferSettings<typeof theme00>;

const resolved = new WeakMap<StoreContext, ThemeSettings>();

export function settingsOf(store: StoreContext): ThemeSettings {
  let values = resolved.get(store);
  if (values === undefined) {
    values = resolveThemeSettings(theme00, store.config.themeSettings, {
      content: store.content,
      locales: [store.locale, ...store.fallbackLocales],
    }).values;
    resolved.set(store, values);
  }
  return values;
}
