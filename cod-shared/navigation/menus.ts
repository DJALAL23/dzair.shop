/**
 * Navigation menus — store data, read by themes through `/store/menus/:handle`.
 *
 * A menu is a handle ("main-menu"), a title and up to three levels of items.
 * An item points at a storefront page type (`cod-shared/storefront/routes.ts`)
 * or at a URL; the server turns it into a path, so a theme never builds a
 * menu link itself. `@wocart/theme` mirrors the handle pattern for its `menu`
 * setting kind (guarded by `scripts/check-platform-parity.mjs`).
 */
import type { StorefrontPageType } from "../storefront/routes";

export const MENU_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** At most this many levels: an item, its children, theirs. */
export const MENU_MAX_DEPTH = 3;
/** At most this many items in one menu. */
export const MENU_MAX_ITEMS = 100;

export const MENU_DESTINATION_TYPES = ["home", "catalog", "category", "product", "page", "landing", "url"] as const;
export type MenuDestinationType = (typeof MENU_DESTINATION_TYPES)[number];

/** The destinations that name one resource, by its id. */
export const MENU_RESOURCE_DESTINATIONS = ["category", "product", "page", "landing"] as const satisfies readonly MenuDestinationType[];

export type MenuDestination =
  | { type: "home" | "catalog" }
  | { type: "category" | "product" | "page" | "landing"; ref: string }
  | { type: "url"; url: string };

/** The storefront page type a destination opens (every type but `url`). */
export const DESTINATION_PAGE_TYPE: Record<Exclude<MenuDestinationType, "url">, StorefrontPageType> = {
  home: "home",
  catalog: "catalog",
  category: "category",
  product: "product",
  page: "page",
  landing: "landing",
};

/**
 * Whether a merchant may point a menu item at this URL: a path of this store
 * (`/pages/faq`, never `//elsewhere`), an http(s) address, or a mailto/tel
 * link. Script schemes and anything with whitespace or control characters
 * are refused — a theme renders it as an `href` as is. The same rule as
 * `@wocart/theme`'s `url` field.
 */
export function isMenuUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (value.startsWith("#") || value.startsWith("?")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?([/?#]|$)/i.test(value);
  if (scheme === "mailto" || scheme === "tel") return value.length > scheme.length + 1;
  return false;
}
