/**
 * The store's menus as this theme renders them. The server already resolved
 * every destination and left out what leads nowhere public; this only puts
 * internal links into the request's language and marks the current page.
 */
import type { StoreMenu, StoreMenuItem } from "@wocart/storefront";

export interface NavLink {
  label: string;
  href: string;
  /** Leaves the store: opened as is, never localized. */
  external: boolean;
  /** This page, or a page under it. */
  active: boolean;
  children: NavLink[];
}

const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

function isActive(item: StoreMenuItem, pathname: string): boolean {
  if (!isInternal(item.href)) return false;
  const path = item.href.split(/[?#]/)[0]!;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * A menu's items as links: `href` localizes a path of the store, `pathname`
 * is this page's path without its language prefix. Null when there is no
 * menu or it holds nothing — the caller renders its own links then.
 */
export function menuLinks(menu: StoreMenu | null, href: (path: string) => string, pathname: string): NavLink[] | null {
  if (!menu || menu.items.length === 0) return null;
  const toLinks = (items: readonly StoreMenuItem[]): NavLink[] =>
    items.map((item) => ({
      label: item.label,
      href: isInternal(item.href) ? href(item.href) : item.href,
      external: /^https?:\/\//i.test(item.href),
      active: isActive(item, pathname),
      children: toLinks(item.children),
    }));
  return toLinks(menu.items);
}
