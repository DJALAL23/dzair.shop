/**
 * The Collections screen's logic — everything that isn't a fetch or a pixel.
 * What a collection may hold (its handle, its size) is decided once in
 * cod-shared/catalog/collections.ts; this file only edits the ordered list
 * the merchant sees.
 *
 * Like the other feature models, it does not import `ApiError` (that module
 * needs Astro's env); `isApiError` duck-types the one property it reads.
 */
import { COLLECTION_HANDLE_RE, COLLECTION_MAX_PRODUCTS } from "../../../../cod-shared/catalog/collections";

export { COLLECTION_MAX_PRODUCTS };

/** A handle from a title: `Best sellers` → `best-sellers`. Script with no Latin letters gives `collection`. */
export function handleFromTitle(title: string): string {
  const handle = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return handle || "collection";
}

export const isValidHandle = (handle: string) => COLLECTION_HANDLE_RE.test(handle);

/** The list with the item at `index` moved one place up or down; unchanged at an end. */
export function move<T>(items: readonly T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The list with this item added at the end, unless it is already in it or the list is full. */
export function addLast<T extends { id: string }>(items: readonly T[], item: T): T[] {
  if (items.some((entry) => entry.id === item.id) || items.length >= COLLECTION_MAX_PRODUCTS) return [...items];
  return [...items, item];
}

/** Duck-types `@/lib/api`'s `ApiError` — see the module comment. */
function isApiError(value: unknown): value is { code?: string } {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "ApiError";
}

/** A thrown error as a message in the merchant's language — never the server's own text. */
export function collectionsErrorMessage(cause: unknown, t: (key: string) => string): string {
  if (isApiError(cause)) {
    switch (cause.code) {
      case "DUPLICATE_COLLECTION_HANDLE":
        return t("errors.handle_taken");
      case "COLLECTION_NOT_FOUND":
        return t("errors.not_found");
      case "INVALID_COLLECTION_PRODUCTS":
      case "VALIDATION_FAILED":
        return t("errors.validation");
    }
  }
  return t("errors.generic");
}
