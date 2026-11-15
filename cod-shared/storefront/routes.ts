/**
 * The storefront's page types and their public paths — the authoritative
 * declaration. `@wocart/storefront` mirrors it (`src/routes.ts`), guarded by
 * `scripts/check-platform-parity.mjs`.
 *
 * A page type is what a URL *means* (a product, a store page, a landing page);
 * the path is where it lives. The paths are a platform contract, not a theme
 * choice, because the platform builds them without running the theme: the
 * dashboard shows a page's public link, the server names the landing page in
 * a conversion's source URL, the AI tools return landing-page links. A theme
 * renders these page types at these paths (Astro file routes), builds every
 * link to them through `storefrontPath`, and may add any route of its own.
 */

export const STOREFRONT_PAGE_PATHS = {
  home: "/",
  catalog: "/products",
  category: "/category/:slug",
  collection: "/collections/:handle",
  product: "/products/:handle",
  page: "/pages/:slug",
  landing: "/lp/:slug",
  checkout: "/checkout",
  thankYou: "/thank-you",
  /** Where a shopper follows an order by its number and phone; `?order=<number>` fills the number in. */
  trackOrder: "/track-order",
  /** The store's products matching a query; `?q=<words>` is the query. */
  search: "/search",
  /** How to reach the store: its WhatsApp, phone, email and address. */
  contact: "/contact",
} as const;

export type StorefrontPageType = keyof typeof STOREFRONT_PAGE_PATHS;

/** The page types whose path names one resource, and the parameter that names it. */
type ParamOf<P extends string> = P extends `${string}:${infer Name}` ? Name : never;
export type StorefrontPathParams<T extends StorefrontPageType> = ParamOf<(typeof STOREFRONT_PAGE_PATHS)[T]> extends never
  ? Record<string, never>
  : { [K in ParamOf<(typeof STOREFRONT_PAGE_PATHS)[T]>]: string };

/** The public path of a page: `storefrontPath("landing", { slug: "robe-ete" })` → `/lp/robe-ete`. */
export function storefrontPath<T extends StorefrontPageType>(type: T, params?: StorefrontPathParams<T>): string {
  return STOREFRONT_PAGE_PATHS[type].replace(/:([a-z]+)/g, (_, name: string) => {
    const value = (params as Record<string, string> | undefined)?.[name];
    if (!value) throw new Error(`storefrontPath("${type}") needs "${name}"`);
    return encodeURIComponent(value);
  });
}

/** A pathname recognised as one of the page types, with its parameter. */
export interface StorefrontPageMatch {
  readonly type: StorefrontPageType;
  readonly params: Readonly<Record<string, string>>;
}

const MATCHERS = (Object.entries(STOREFRONT_PAGE_PATHS) as Array<[StorefrontPageType, string]>).map(([type, path]) => {
  const names: string[] = [];
  const source = path.replace(/:([a-z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { type, names, pattern: new RegExp(`^${source}$`) };
});

/**
 * Which page type a pathname is, and its parameter (decoded), or null for any
 * other path. Exact matches only; the query, the fragment and a trailing
 * slash are ignored. Pass a pathname without its language prefix.
 */
export function matchStorefrontPath(rawPathname: string): StorefrontPageMatch | null {
  const pathname = rawPathname.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  for (const { type, names, pattern } of MATCHERS) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    try {
      return { type, params: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)])) };
    } catch {
      return null;
    }
  }
  return null;
}
