/**
 * The customer-facing order number: `ORD-YYYYMMDD-NNNN`, the day plus four
 * random digits. The orders table keeps it unique, so two orders on the same
 * day can draw the same number; the second insert is then refused and the
 * whole commit batch rolls back. Every order writer commits through
 * `isOrderNumberCollision` + a fresh draw, so a collision costs a retry, never
 * a lost order.
 */

/**
 * What a shopper may type as an order number: `ORD-`, the day, and digits, in
 * any case. Mirrored by `@wocart/storefront` (`ORDER_NUMBER_PATTERN`).
 */
export const ORDER_NUMBER_RE = /^ORD-\d{8}-\d+$/i;

/** Draws are capped: a collision is rare, so a handful of draws is ample. */
export const MAX_ORDER_NUMBER_DRAWS = 5;

export function drawOrderNumber(now: string | Date = new Date()): string {
  const iso = typeof now === "string" ? now : now.toISOString();
  const dateStr = iso.split("T")[0].replace(/-/g, "");
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `ORD-${dateStr}-${random}`;
}

/** The unique order-number column refused the insert, so another number is needed. */
export function isOrderNumberCollision(error: unknown): boolean {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const text = `${error instanceof Error ? error.message : String(error)} ${cause ?? ""}`;
  return /UNIQUE constraint failed: orders\.order_number/.test(text);
}
