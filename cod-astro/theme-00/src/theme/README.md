# Theme Layer

✅ **SAFE TO CUSTOMIZE** ✅

This directory contains all UI components, styling, and content you can
customize without breaking the Wocart integration. Platform behavior comes
from `@wocart/storefront`, bound in `src/theme/sdk.ts` (reads) and
`src/theme/utils/images.ts` (image URLs). There is no local core layer any more
— `src/core/` was deleted; do not add one.

## What's in the Theme Layer?

### `components/`
Reusable UI components organized by feature:

#### `layout/`
- `BaseHead.astro` - `<head>`, SEO/OG meta, fonts, runtime design-token injection, Meta Pixel
- `Header.astro` - Top bar with brand + the store's header menu (a popover menu on phones)
- `Footer.astro` - Multi-column footer with trust badges
- `MobileNav.astro` - Mobile bottom-tab navigation (the theme's signature)

#### `home/`
- `Hero.astro` - Gradient hero with CTAs + trust badges
- `CategoryCards.astro` - Category image cards (top 4; receives `categories` prop)
- `BestSellers.astro` - Featured-products grid (receives `products` prop)
- `NewArrivals.astro` - Newest-products grid (receives `products` prop)
- `HowItWorks.astro` - 3-step COD trust section
- `FeaturesBar.astro` - Icon trust strip
- `WhatsAppCTA.astro` - Promo banner with CTA
- `CustomerTestimonials.astro` - Review cards (receives `products` + `enabled`; fetches its own review pages)

Home sections are presentational: `src/pages/index.astro` owns the single
catalog/category read.

#### `listing/`
- `ListingMain.astro` - The listing template's section: all products, a category or a collection (`catalog/listing/listing-main.def.ts`)
- `PageMain.astro` - A text page's section (`catalog/listing/page-main.def.ts`)
- `ListingPager.astro` - Previous / next pages of a listing

#### `product/`
- `ProductCard.astro` - Product card for grid listings
- `ProductGallery.astro` - Image gallery with thumbnails
- `RelatedProducts.astro` - Same-category products (server island)
- `ReviewsList.astro` - Customer reviews display
- `ReviewForm.astro` - Review submission form
- `ReviewsIsland.astro` - Client-side reviews island
- `ShippingIsland.astro` - Client-side shipping calculator island

#### `product-page/`
The product template's sections and blocks (`catalog/product/`): `ProductMain`
(gallery beside the info column), one component per block (title, rating,
price, signals, order form, countdown, description, rows, policies, text),
`ProductReviews` and `ProductRelated`.

#### `order/`
- `OrderForm.astro` - Main order form
- `VariantSelector.astro` - Product variant selection UI
- `OfferTiers.astro` - Quantity/offer tier selection
- `CustomerFields.astro` - Name, phone, wilaya, commune, address inputs
- `OrderSummary.astro` - Order summary ticket

#### `ui/`
- `Select.astro` - Reusable dropdown (carries the v1.0.88 dropdown fix)

### `layouts/`
- `StoreLayout.astro` - Global HTML shell: `<html lang dir>`, head, header, footer, mobile nav

### `content/` — all user-facing strings
- `types.ts` - The `StoreFrontContent` interface (155 keys, enforced exactly)
- `ar.ts` / `fr.ts` / `en.ts` - Arabic, French, English packs. All three must
  stay in sync — TypeScript fails the build if one misses a key.
- `index.ts` - `resolveContent(lang, overrides)` + `getSupportedLanguages()`.
  The store language's overrides (`StoreConfig.contentOverrides[lang]`) are
  merged per key: only values that are
  strings, and only for keys the pack declares — anything else is ignored.
- `index.test.ts` - Pins the override contract (nested/unknown/non-string
  shapes degrade to the pack)

### `bridges/` — SSR ↔ browser contracts & island props
- `product-page-data.ts` - The `#page-data` SSR→browser contract
- `island-props.ts` - Typed copy picks for server islands (keeping island URLs
  within Astro's 2048-byte caching budget)

### `runtime/`
- `store.ts` - `UNAVAILABLE_STORE` (the SDK's shell for a store that cannot
  be read) and the per-request store context (config + resolved content)
- `navigation.ts` - `menuLinks()`: a store menu as header/footer links in the
  request's language

### `settings.ts` — the theme's global settings
The settings a merchant sets once for the whole store, edited in the theme
editor: the colors, the font (one of `fonts.json`) and which menu the header
and the footer show (`main-menu` and `footer`, which every store starts with
and the merchant edits in the dashboard's Navigation screen). `StoreLayout`
reads them with `resolveThemeSettings` from `StoreConfig.themeSettings`. The
theme has no links of its own: a place whose menu the store does not have
shows none.

Every link to a product, a category, a store page, the catalog or the
checkout is built with `storefrontPath` from `@wocart/storefront` — the
platform owns those paths (guarded by `__tests__/guards/page-paths.test.ts`).

### `sdk.ts` — the platform adapter (the ONE SDK seam)
- `getStoreClient()` creates the `@wocart/storefront` client from server env:
  one client per store scope, fail-fast when `STORE_API_KEY` is missing.
  Server code only — import it in page frontmatter, actions, middleware, and
  endpoints; browser scripts use `@wocart/storefront` directly for
  browser-safe helpers. `__tests__/guards/sdk-boundary.test.ts` guards both rules, and the
  `createStoreClient` call must not appear anywhere else.

### `styles/`
- `global.css` - Design tokens (`:root`), Tailwind v4 `@theme` bridge, component styles

### `scripts/`
- `product.ts` - Client-side product-page interactions (variants, quantity, shipping)
- `checkout.ts` / `cart.ts` / `cart-ui.ts` / `cart-render.ts` - Basket checkout controller and drawer
- `product.test.ts` - Fast-check property tests for the product script
- `track-abandonment.ts` - Abandoned-order tracking: sends the theme's
  same-origin abandoned-checkout route when a visitor typed a valid name + phone and stays on the page without
  submitting (one record per tab via sessionId upsert)

### `utils/`
- `seo.ts` - SEO helpers (`getProductJsonLd`, JSON-LD structured data)
- `money.ts` - The theme's display binding over SDK `formatMoney` (locale and symbol)
- `seo.ts` - JSON-LD helpers; commerce availability comes from SDK `getProductView`
- `images.ts` - Media-domain image binding (server-only, SDK image helpers)

## Customization Examples

### Change the default colors, font and menus

Edit `settings.ts`. Each setting's `default` is what a store renders until the
merchant changes it in the theme editor; a value the theme cannot use falls
back to it. Colors and the font are the theme's, never read from the old
`StoreConfig` color/font fields (deprecated in the SDK).

### Change UI text

Edit the three locale files in `content/` — `ar.ts`, `fr.ts`, `en.ts`. Add a
new key to `content/types.ts` **first**, fill it in **all three** files, then
read it in the component:

```typescript
// content/types/home.ts
export type HomeStrings = { heroTitle: string; /* ... */ };

// content/ar/home.ts  (one file per area, per locale)
export const arHome: HomeStrings = {
  heroTitle: "اكتشف أفضل المنتجات",
  // ...
};
```

Never type a visible string literal in a component — components receive the
resolved pack as the `content` prop.

### Modify component styling

Edit any `.astro` component. Colors, radii, fonts, and shadows must come from
the design tokens in `styles/global.css` (`var(--clr-primary)`,
`var(--radius-btn)`, …), never hardcoded hex values.

### Update the design tokens

Edit `styles/global.css` — static tokens live in `:root`; the partner's
runtime overrides (`--clr-primary`, `--clr-accent`, `--clr-bg`, `--font-body`)
are injected by `BaseHead.astro` at request time.

### Modify client-side interactions

Edit `scripts/product.ts` to change variant selection, quantity controls, or
the shipping calculator behavior. Browser scripts are processed natively by Astro
via `<script src="...">` tags on pages that need them.

## Import Paths

Theme files use the `@/theme/*` path alias:

```typescript
import ProductCard from "@/theme/components/product/ProductCard.astro";
import { getStoreContext } from "@/theme/runtime/store";
import { getProductJsonLd } from "@/theme/utils/seo";
import { resolveContent, type StoreFrontContent } from "@/theme/content";
```

## Best Practices

1. **Test after changes** — run `npm test`, `npm run validate:strings`,
   `npm run validate:styles`, and `npm run build`.
2. **Preserve functionality** — keep form inputs, data attributes, and IDs
   that scripts depend on.
3. **Accessibility** — ARIA labels, semantic HTML, keyboard navigation, and
   `aria-*` content keys.
4. **RTL** — test in `lang="ar" dir="rtl"` (default) and both LTR locales.
   Use logical properties (`padding-inline`, `start-*`/`end-*`), never
   physical left/right.
5. **Responsive** — mobile-first with the bottom nav; test mobile, tablet, desktop.

## Getting Help

- See `src/theme/sdk.ts` + `src/theme/utils/images.ts` for the platform seams
  (extend the SDK, never re-implement it in the theme)
- See `THEME_GUIDE.md` (package root) for the design system and hard rules
- See `CONTENT_KEYS_REFERENCE.md` (package root) for every content key
- See `CONTRIBUTING.md` (repo root) for repo-wide conventions
