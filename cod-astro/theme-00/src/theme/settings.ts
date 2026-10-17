/**
 * Theme-00's global settings: what a merchant chooses once for the whole
 * store, read from `StoreConfig.themeSettings` against this declaration
 * (`resolveThemeSettings`). Store identity — the logo, the brand colors —
 * stays the store's own and is not repeated here.
 *
 * `font` has no default on purpose: until the merchant picks one here, the
 * store's font from the dashboard applies (`themeFont` in utils/brand.ts).
 * The menus name a menu by handle; a store without that menu shows the
 * theme's own links.
 */
import type { SettingsGroup } from "@wocart/theme";
import themeFonts from "./fonts.json";
import { SETTING, SETTINGS_GROUP } from "./catalog/labels";

const FONT_FAMILIES = themeFonts.map((font) => font.family) as [string, ...string[]];

export const THEME_SETTINGS = [
  {
    key: "typography",
    label: SETTINGS_GROUP.typography,
    fields: [{ key: "font", kind: "select", label: SETTING.font, options: FONT_FAMILIES }],
  },
  {
    key: "navigation",
    label: SETTINGS_GROUP.navigation,
    fields: [
      { key: "headerMenu", kind: "menu", label: SETTING.headerMenu, default: "main-menu" },
      { key: "footerMenu", kind: "menu", label: SETTING.footerMenu, default: "footer" },
    ],
  },
] as const satisfies readonly SettingsGroup[];
