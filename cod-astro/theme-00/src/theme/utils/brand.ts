/**
 * A color that arrives as merchant data — a variant's swatch — validated
 * before it reaches a style attribute: it is never trusted as CSS.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeHex(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value) ? value.toLowerCase() : fallback;
}
