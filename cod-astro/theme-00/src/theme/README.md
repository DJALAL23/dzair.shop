# Theme Layer

✅ **SAFE TO CUSTOMIZE** ✅

This directory contains all UI components, styling, and content you can
customize without breaking the CodFlow integration. Platform behavior comes
from `@codflow/storefront`, bound in `src/theme/sdk.ts` (reads) and
`src/theme/utils/images.ts` (image URLs). There is no local core layer any more
— `src/core/` was deleted; do not add one.

## What's in the Theme Layer?

### `components/`
Reusable UI components organized by feature:

#### `layout/`
- `BaseHead.astro` - `<head>`, SEO/OG meta, fonts, runtime design-token injection, Meta Pixel
- `Header.astro` - Top bar with brand + navigation
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
catalog/category read. See `docs/history/PRODUCT_ZERO_AUDIT.md` §3.

#### `listing/`
- `CategoryPageContent.astro` - Category listing page content
- `ProductsListContent.astro` - All-products listing page content

#### `product/`
- `ProductCard.astro` - Product card for grid listings
- `ProductGallery.astro` - Image gallery with thumbnails
- `ProductInfo.astro` - Product title, price, description
- `ProductDetailContent.astro` - Full product detail + order form wrapper
- `ReviewsList.astro` - Customer reviews display
- `ReviewForm.astro` - Review submission form
- `ReviewsIsland.astro` - Client-side reviews island
- `ShippingIsland.astro` - Client-side shipping calculator island

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
- `store.ts` - `DEFAULT_CONFIG` (fallback colors/font/meta) and
  `getStoreContext()` (per-request store config + resolved content)

### `sdk.ts` — the platform adapter (the ONE SDK seam)
- `getStoreClient()` creates the `@codflow/storefront` client from server env:
  one client per store scope, fail-fast when `STORE_API_KEY` is missing.
  Server code only — import it in page frontmatter, actions, middleware, and
  endpoints; browser scripts use `@codflow/storefront` directly for
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

### Change the fallback colors and fonts

Edit `runtime/store.ts` → `DEFAULT_CONFIG`. This only matters when the API is
unreachable — live stores get colors/font from the dashboard
(`StoreConfig.primaryColor` / `accentColor` / `bgColor` / `fontFamily`):

```typescript
export const DEFAULT_CONFIG: StoreConfig = {
  primaryColor: "#7c3aed",   // Brand color (fallback)
  accentColor: "#f59e0b",    // Accent color (fallback)
  bgColor: "#f8f8f8",        // Page background (fallback)
  fontFamily: "Cairo, sans-serif",
  // ...
};
```

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
- See `docs/history/PRODUCT_ZERO_AUDIT.md` for the
  platform/theme/config/content boundaries and the P0/P1 plan
- See `THEME_GUIDE.md` (package root) for the design system and hard rules
- See `CONTENT_KEYS_REFERENCE.md` (package root) for every content key
- See `CONTRIBUTING.md` (repo root) for repo-wide conventions
