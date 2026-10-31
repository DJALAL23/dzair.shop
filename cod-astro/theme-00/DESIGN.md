# Theme-00 — design system

Theme-00 is the default storefront theme: free, installed on every new store,
and the reference every other theme is measured against.

**The world: "The Parcel."** Every product is shown the way it arrives at the
door: a whole photo on a carton plate, a printed facts panel, and an order form
set like a courier waybill whose last line is the amount paid on delivery. Flat
print, hairline rules, crisp corners, tabular numerals. No soft rounded-card
storefront, no gradients, no decorative glass.

Sources of truth: the tokens and component classes in
`src/theme/styles/global.css`; merchant-controlled values in
`src/theme/utils/brand.ts`; the layout frame in `src/theme/layouts/StoreLayout.astro`.

## Merchant controls (never break these)

| Setting | Where it lands | Guard |
| --- | --- | --- |
| Brand color (`primaryColor`) | `--clr-primary`: buttons, top band, the COD total, price stamps | `safeHex` rejects anything that is not a 3- or 6-digit hex |
| Text on brand (`onPrimary`) | `--clr-on-primary`: paper or ink, whichever reads better | `onColor` picks by WCAG contrast |
| Light brand color as text | `--clr-primary-ink`: darkened until 4.5:1 on paper | `brandInk` |
| Accent (`accentColor`) | `--clr-accent`: discount stamps, highlights | `onColor` pairing in `--clr-on-accent` |
| Background (`bgColor`) | `--clr-bg`: page ground | `safeHex` |
| Font (`fontFamily`) | `--font-body` | matched by name against the five faces in `src/theme/fonts.json`; anything else, and the platform default, renders in the theme's default face (Readex Pro). `fontUrl` is never loaded |
| Logo, store name | header | `Image` with fixed dimensions |
| Home sections and their copy | the page document + editable fields | every rendered string is a field or a shared label (`editor-coverage` guard) |

Never write a merchant value into CSS without one of these guards.

## Tokens

**Ink and paper** (`:root`)

| Token | Value | Use |
| --- | --- | --- |
| `--clr-surface` | `#ffffff` | cartons, waybill, inputs |
| `--clr-surface-alt` | `#f1f2f4` | photo plates, disabled fill |
| `--clr-border` | `#dfe2e6` | hairlines, carton edges |
| `--clr-rule` | `#111318` | the heavy 3px rule over the hero's facts |
| `--clr-text` | `#111318` | primary text (18.6:1 on white) |
| `--clr-text-2` | `#474d57` | secondary text (8.5:1) |
| `--clr-text-3` | `#5f656f` | tertiary text (5.2:1 on the grey plate) |
| `--clr-success` / `--clr-error` | `#0f7a4a` / `#b42318` | status only |

Every text pairing is at least 4.5:1 (AA for small text), checked against the
backgrounds each color sits on. `validate:styles`
forbids hardcoded colors in components: use these tokens.

**Type scale** — the only sizes: `text-2xs` 0.6875rem · `xs` 0.75rem · `sm` 0.875rem ·
`base` 1rem · `lg` 1.125rem · `xl` 1.375rem · `2xl` 1.75rem · `3xl` 2.25rem · `4xl` 3rem · `5xl` 3.75rem · `6xl` 4.5rem (the desktop hero headline only).
Headings use weight 700 and tight leading; body is 1rem / 1.6. Prices use
`.price` (tabular numerals). Body text measure stays under ~75ch.

**Radius** — `--radius-card` 0.375rem · `--radius-input` 0.25rem · `--radius-btn` 0.25rem ·
`--radius-tag` 0.125rem. Crisp, die-cut corners. The WhatsApp launcher is the
one round control, and it is platform code.

**Shadow** — flat by default. `--shadow-lg` only on things that float (the
language menu, the lead slip on desktop). `--shadow-primary` only on the primary button in
hover states.

**Motion** — one easing, `--ease-out-expo`. Transitions are 150ms for color and
100ms for press; photo zooms are 600ms. Everything respects
`prefers-reduced-motion`.

**Spacing** — Tailwind's 4px lattice only. The frame is `.frame`: 1rem gutter on
phones, 1.5rem from 640px, 2rem from 1024px, max width 80rem.

## Components

| Class / component | What it is |
| --- | --- |
| `.carton` | the theme's one container: surface, 1px border, card radius. Product cards, categories, reviews |
| `.plate` | a photo's stage: alt surface, the product shown whole (`object-fit: contain`) |
| `.section-head` (`SectionHead.astro`) | the section opener: title, sub-line, "view all" — no rule; space and type separate sections |
| `.stamp` / `.stamp-accent` / `.stamp-ink` / `.stamp-warn` / `.stamp-line` | rubber-stamp labels: discount, sold out, low stock, verified buyer |
| `.price` / `.price-cur` / `.price-was` | prices: tabular, weight 700; the old price struck through |
| `.btn-primary` / `.btn-secondary` | the two actions. Primary = brand color; secondary = outline in ink. Disabled = striped |
| `.waybill` / `.waybill-head` / `.perforation` / `.cod-total` | the order form as a courier label: ink header, sections, a perforated tear line, the COD total band |
| `.form-input` / `.form-label` | waybill fields: 1px border, ink on focus, 3px focus ring in the brand tint |
| `.route` (`HowItWorks.astro`) | the cash-on-delivery path as three stops on a dashed line |
| `.slip` (`Hero.astro`) | the hero's packing slip: the lead product's line and photo, then a list of the next products |
| `.frame` | the page's horizontal rhythm (see Spacing) |
| `.hero-facts` (`Hero.astro`) | the three promises under the hero: a heavy top rule, icon, label and line per row |
| `.promises` (`FeaturesBar.astro`) | the four promises on one paper strip |
| `.category-row` (`CategoryCards.astro`) | categories: a swipe row on phones, a grid from 640px |

## Layout

- **Header:** sticky, 4rem, the logo start, the four section links on desktop
  only, then language (native popover), search, cart.
- **Phones:** a two-item bottom bar (Home, Products) and a single column.
  Photos never crop; the lead slip is square.
- **Desktop hero:** the copy and the lead slip share one height. The headline
  leads at the top; the buttons and promises close at the bottom, level with the
  slip's last line. The whole hero fits a 900px-tall screen, and the lead photo
  fills whatever height is left, shown whole.
- **Desktop product pages:** two columns, the photo left and the waybill sticky right.
- **Home order:** hero → categories (a swipe row on phones) → best sellers →
  how it works (the route) → new arrivals → promise band → brand band → reviews.

## Rules

1. Colors, radii, shadows and fonts come from tokens. No literal values in components.
2. One hairline per surface. Sections are separated by space and by paper bands, never by lines drawn across the page.
3. Never crop a product photo. Use `.plate` and `object-fit: contain`.
4. Every order-critical action sits in the waybill and stays visible on phones.
5. Never show a discount stamp or a stock warning the server did not send.
6. Sold-out is a stamp and a greyed action on the card, never a hidden product.
7. Keep Arabic first: right-to-left is the primary layout, and every
   directional icon uses `.flip-rtl`.

## Fonts

Five faces ship with the theme, declared once in `src/theme/fonts.json`:
Readex Pro (the default), Tajawal, Almarai, Noto Kufi Arabic and IBM Plex Sans
Arabic. `astro.config.mjs` reads the same file and passes each one to Astro's
font API, which downloads it from Google once at build time and serves it from
the store's own domain. Visitors make no request to Google. A page declares
only its chosen face and preloads the file for its script (Arabic or Latin).

To add a face: add it to `fonts.json` with an Arabic-capable family, and it is
available at once. Never load a font from a third-party URL at runtime; a guard
test (`no-third-party-fonts.test.ts`) fails the build if one appears.

## Images

Product and category photos are resized by the store's media delivery, which the
server gives the storefront in its store configuration (`media`): ImageKit's own
resizer when the store keeps its images on ImageKit, or Cloudflare Image Resizing on
the store's zone when they are in R2. `<Image>` builds each URL with
`@wocart/storefront`'s `mediaImageUrl`. On a Cloudflare zone, **Images →
Transformations** must be enabled, or resized photos do not load. The original file
is the fallback when a resize fails. The dev server uses the original files.

## Accessibility

- Focus is always visible (`:focus-visible`, 2px ink outline, 2px offset).
- Touch targets are at least 2.75rem; primary actions 3.25–4rem.
- Language switcher: a native popover; Escape and outside clicks close it.
- Reduced motion turns every animation and transition off.

## Not in this system

- Gradients, glass, blur used as decoration, colored side borders, gradient text.
- Hardcoded hex or rgb in components (`validate:styles` enforces it).
- Writing into the merchant's page document: the theme only reads it.
