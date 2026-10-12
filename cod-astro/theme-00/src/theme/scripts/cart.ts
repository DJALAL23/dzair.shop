/**
 * Browser-side shopping cart (S9) — the theme's ONE basket binding.
 *
 * The basket is a *wish*, not a fact. It lives in this browser and nowhere
 * else: the only facts are the catalog price and the stock count, which the
 * server re-reads at checkout whatever this file claims.
 *
 * Persistence, sanitising, duplicate merging, the line and quantity caps,
 * cross-tab notifications and the `items[]` wire projection are all
 * `@codflow/storefront`'s `createBasketStore` — this module binds exactly one
 * store per tab and re-exports the names the theme's scripts already import.
 * A rule about baskets therefore has one definition, in the SDK, and one
 * place to change it; the S9 gate forbids re-deriving any of it here.
 *
 * Defensive by contract, still: the SDK's store degrades a broken/blocked
 * localStorage to "no cart", never to a broken storefront, and without a
 * `window` (SSR, tests) it falls back to memory.
 */
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  basketLineKey,
  createBasketStore,
  toOrderItems as projectOrderItems,
  type CartLine,
} from "@codflow/storefront";

export { MAX_CART_LINES, MAX_LINE_QUANTITY };
export type { CartLine };

const store = createBasketStore();

type Listener = (lines: CartLine[]) => void;

/** Same identity rule the server uses: product AND variant. */
export function lineKey(productId: string, variantId: string | null): string {
  return basketLineKey(productId, variantId);
}

/** A snapshot, not the store's own array — callers cannot mutate the basket by accident. */
export function getCart(): CartLine[] {
  return [...store.getLines()];
}

/** Whether the cart can persist at all. The UI hides itself when it cannot. */
export function isCartAvailable(): boolean {
  return store.isPersistent();
}

export function cartCount(lines: CartLine[] = getCart()): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function cartSubtotal(lines: CartLine[] = getCart()): number {
  return lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
}

/** Returns the resulting cart so callers can render without a second read. */
export function addLine(line: CartLine): CartLine[] {
  return [...store.addLine(line)];
}

export function setQuantity(key: string, quantity: number): CartLine[] {
  return [...store.setQuantity(key, quantity)];
}

export function removeLine(key: string): CartLine[] {
  return [...store.removeLine(key)];
}

export function clearCart(): CartLine[] {
  return [...store.clear()];
}

/**
 * Subscribe to cart changes, including changes made in another tab.
 *
 * Returns an unsubscribe function. The store re-reads storage on the browser's
 * `storage` event, which only fires in OTHER tabs — exactly what keeps a
 * second tab's badge honest.
 */
export function subscribe(listener: Listener): () => void {
  return store.subscribe((lines) => listener([...lines]));
}

/** The wire shape POST /store/cart/validate and the order form both expect. */
export function toOrderItems(lines: CartLine[] = getCart()) {
  return projectOrderItems(lines);
}
