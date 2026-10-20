/**
 * How a store looks, as the theme's settings decide it: the default color
 * schemes, the faces for headings and text, the corners, the product cards'
 * image shape, and the sizes behind the style steps a merchant picks. Plain
 * data and pure functions — the layout turns them into the page's tokens.
 */
import type { CssVariable } from "astro:assets";
import type { ColorScheme, ThemeStyle } from "@wocart/theme";
import { SCHEME } from "./catalog/labels";
import themeFonts from "./fonts.json";
import styleSizes from "./style-sizes.json";

/**
 * The schemes a store starts with. The first is the page's; the others band
 * sections: a stone ground, a cool mist, the night of the footer, saffron for
 * a promotion. Their ids never change, since sections store them.
 */
export const DEFAULT_SCHEMES = [
  {
    id: "scheme-1",
    name: SCHEME.light,
    colors: { background: "#ffffff", text: "#3a4252", heading: "#101b30", accent: "#d9982c", button: "#101b30", buttonText: "#ffffff", border: "#e4e6ea" },
  },
  {
    id: "scheme-2",
    name: SCHEME.stone,
    colors: { background: "#f4f4f0", text: "#3a4252", heading: "#101b30", accent: "#d9982c", button: "#101b30", buttonText: "#ffffff", border: "#dcddd6" },
  },
  {
    id: "scheme-3",
    name: SCHEME.mist,
    colors: { background: "#edf0f7", text: "#364160", heading: "#101b30", accent: "#d9982c", button: "#1f3c96", buttonText: "#ffffff", border: "#d5dbea" },
  },
  {
    id: "scheme-4",
    name: SCHEME.night,
    colors: { background: "#101b30", text: "#c3cad8", heading: "#ffffff", accent: "#e9b04a", button: "#ffffff", buttonText: "#101b30", border: "#28344d" },
  },
  {
    id: "scheme-5",
    name: SCHEME.saffron,
    colors: { background: "#f1b74e", text: "#2a2416", heading: "#101b30", accent: "#101b30", button: "#101b30", buttonText: "#ffffff", border: "#d29a35" },
  },
] as const satisfies readonly ColorScheme[];

export type SchemeId = (typeof DEFAULT_SCHEMES)[number]["id"];

/** The page's scheme unless the merchant picks another. */
export const PAGE_SCHEME: SchemeId = "scheme-1";

/** The sizes the theme gives the platform's style steps and widths, in pixels. */
export const THEME_STYLE: ThemeStyle = styleSizes;

/** A face the theme ships: its family name and the variable Astro registered it under. */
export type ThemeFont = { family: string; cssVariable: CssVariable };

/** Astro types each variable from the configured list, so a typo here fails the build. */
const FONTS = themeFonts as { family: string; cssVariable: CssVariable; default?: boolean; headingDefault?: boolean }[];

export const FONT_FAMILIES = FONTS.map((font) => font.family) as [string, ...string[]];
export const BODY_FONT = FONTS.find((font) => font.default)!.family;
export const HEADING_FONT = FONTS.find((font) => font.headingDefault)!.family;

/** The face a font setting names; one the theme does not ship renders in that setting's default. */
export function themeFont(family: string, fallback: string = BODY_FONT): ThemeFont {
  const chosen = FONTS.find((font) => font.family === family) ?? FONTS.find((font) => font.family === fallback) ?? FONTS[0]!;
  return { family: chosen.family, cssVariable: chosen.cssVariable };
}

export const CORNERS = ["sharp", "soft", "round"] as const;
export type Corners = (typeof CORNERS)[number];

/**
 * Each corners choice keeps the same order — a photo rounder than a field, a
 * field rounder than a tag — so the hierarchy survives every choice.
 */
const RADII: Readonly<Record<Corners, Readonly<Record<"media" | "panel" | "input" | "button" | "tag", string>>>> = {
  sharp: { media: "0", panel: "0", input: "0.125rem", button: "0.125rem", tag: "0.125rem" },
  soft: { media: "0.75rem", panel: "1rem", input: "0.625rem", button: "0.75rem", tag: "62.5rem" },
  round: { media: "1.25rem", panel: "1.5rem", input: "0.875rem", button: "62.5rem", tag: "62.5rem" },
};

/** The radius tokens for a corners choice; an unknown one is soft. */
export function cornerRadii(corners: string): Readonly<Record<"media" | "panel" | "input" | "button" | "tag", string>> {
  return RADII[(CORNERS as readonly string[]).includes(corners) ? (corners as Corners) : "soft"];
}

export const CARD_RATIOS = ["square", "portrait", "landscape"] as const;
export type CardRatio = (typeof CARD_RATIOS)[number];

/** The CSS aspect ratio of a product card's photo; an unknown shape is portrait. */
export function cardAspect(ratio: string): string {
  return ratio === "square" ? "1 / 1" : ratio === "landscape" ? "4 / 3" : "4 / 5";
}

/** A scheme's background, for the browser's own chrome (`theme-color`); white when the id names none. */
export function schemeBackground(schemes: readonly ColorScheme[] | undefined, id: string | undefined): string {
  return (schemes ?? []).find((scheme) => scheme.id === id)?.colors.background ?? "#ffffff";
}
