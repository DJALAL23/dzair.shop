/**
 * Theme-00's global settings: what a merchant chooses once for the whole
 * store — its colors, its font, the announcement bar's text, which menu the
 * header and the footer show —
 * read from `StoreConfig.themeSettings` against this declaration
 * (`resolveThemeSettings`). Every setting has a default (the announcement's
 * is this theme's own copy, `announcementText`), so a store that
 * saved nothing renders exactly as designed. The merchant edits them in the
 * theme editor (CodFlow Cloud); this theme only reads them.
 *
 * The menus name a store menu by handle: every store starts with `main-menu`
 * and `footer`, which the merchant edits in the dashboard's Navigation screen.
 */
import type { SettingsGroup } from "@wocart/theme";
import themeFonts from "./fonts.json";
import { SETTING, SETTINGS_GROUP } from "./catalog/labels";

const FONT_FAMILIES = themeFonts.map((font) => font.family) as [string, ...string[]];
const DEFAULT_FONT = themeFonts.find((font) => "default" in font && font.default)!.family;

export const THEME_SETTINGS = [
  {
    key: "colors",
    label: SETTINGS_GROUP.colors,
    fields: [
      { key: "primaryColor", kind: "color", label: SETTING.primaryColor, default: "#0b3bbd" },
      { key: "accentColor", kind: "color", label: SETTING.accentColor, default: "#f59e0b" },
      { key: "backgroundColor", kind: "color", label: SETTING.backgroundColor, default: "#f4f5f7" },
    ],
  },
  {
    key: "typography",
    label: SETTINGS_GROUP.typography,
    fields: [{ key: "font", kind: "select", label: SETTING.font, options: FONT_FAMILIES, default: DEFAULT_FONT }],
  },
  {
    key: "announcement",
    label: SETTINGS_GROUP.announcement,
    fields: [{ key: "announcement", kind: "text", label: SETTING.announcement, contentKey: "announcementText" }],
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
