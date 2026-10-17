/**
 * The merchant's brand settings, turned into values the stylesheet can use
 * safely. Colors arrive from the dashboard as free text, so they are validated
 * here and never trusted as CSS.
 */

import type { CssVariable } from "astro:assets";
import themeFonts from "../fonts.json";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The theme's ink and paper — the two text colors a brand color can carry. */
export const INK = "#111318";
export const PAPER = "#ffffff";

export function safeHex(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value) ? value.toLowerCase() : fallback;
}

function channels(hex: string): [number, number, number] {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio between two colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text that stays readable on a field of the brand color: paper or ink, whichever contrasts more. */
export function onColor(hex: string): string {
  return contrast(hex, PAPER) >= contrast(hex, INK) ? PAPER : INK;
}

/**
 * The brand color as text on paper. A light brand color (yellow, mint) cannot
 * carry small text on white, so it is mixed toward ink until it reaches 4.5:1.
 */
export function brandInk(hex: string): string {
  if (contrast(hex, PAPER) >= 4.5) return hex;
  const [r, g, b] = channels(hex);
  const [ir, ig, ib] = channels(INK);
  for (let step = 1; step <= 20; step += 1) {
    const t = step / 20;
    const mixed = `#${[r + (ir - r) * t, g + (ig - g) * t, b + (ib - b) * t]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")}`;
    if (contrast(mixed, PAPER) >= 4.5) return mixed;
  }
  return INK;
}

/** A face the theme ships: its family name and the variable Astro registered it under. */
export type ThemeFont = { family: string; cssVariable: CssVariable };

/** Astro types each variable from the configured list, so a typo here fails the build. */
const FONTS = themeFonts as { family: string; cssVariable: CssVariable; default?: boolean }[];

/** The face the theme's `font` setting names; one the theme does not ship renders in its default face. */
export function themeFont(family: string): ThemeFont {
  const chosen = FONTS.find((font) => font.family === family) ?? FONTS.find((font) => font.default) ?? FONTS[0]!;
  return { family: chosen.family, cssVariable: chosen.cssVariable };
}
