# theme-00 — the Wocart reference theme

theme-00 is Wocart's **reference theme**: the complete, working storefront that
shows how a Wocart theme is built on the platform's SDKs. It is multi-language
(Arabic / French / English), RTL-first, conversion-focused, and neutral enough to
fit any store — beauty, electronics, supplements, home goods, general retail.

Read it as the answer to *"what does a correct Wocart theme look like?"* A new
theme starts from this one; the platform underneath never changes per theme.

> **Two SDKs, two jobs.** `@wocart/storefront` is how a theme talks to
> `cod-server` — the source of truth for products, prices, stock, orders,
> delivery and OTP. `@wocart/theme` is how a theme is *composed* from editable
> sections. Both are consumed **by package name**, never by a relative path.

---

## 1. Where everything lives

```
src/
├── theme/                       # the theme layer — everything customizable
│   ├── components/              #   presentational .astro (home/, product/, listing/, order/, …)
│   ├── catalog/                 #   the composition catalog (code)
│   │   ├── home/<type>.def.ts   #     one definition per section
│   │   └── shared.ts            #     read keys + the copyOverrides bridge
│   ├── pages/                   #   the Home page document (home.page.json — data)
│   ├── content/                 #   UI strings: one folder per locale (ar/ en/ fr/)
│   │   ├── <lang>/<area>.ts     #     one file per area (home, order-form, cart, …)
│   │   └── types/               #     one type per area; types.ts composes them
│   ├── bridges/                 #   SSR ↔ browser contracts & island prop picks
│   │   ├── product-page-data.ts #     #page-data SSR→browser contract
│   │   └── island-props.ts      #     typed copy picks for islands (2048-byte URL budget)
│   ├── theme.ts                 #   the catalog assembler (defineTheme → theme00)
│   ├── sdk.ts                   #   the ONE platform read seam
│   ├── utils/                   #   money.ts, images.ts, seo.ts, related-products.ts
│   ├── layouts/StoreLayout.astro
│   ├── runtime/store.ts         #   UNAVAILABLE_STORE + storeContext (what createStorefrontMiddleware hands each request)
│   ├── scripts/                 #   browser behavior: product.ts, checkout.ts, cart.ts
│   └── styles/global.css        #   design tokens
├── pages/                       # index, products/, category/, thank-you, api/*
├── actions/index.ts             # placeOrder — thin binding over the SDK action
└── middleware.ts                # PRG decision — thin binding over the SDK middleware
```

**Two seams — one file each.** This is the rule the whole theme rests on:

| Seam | The only file | What may cross it |
| --- | --- | --- |
| Platform reads | `src/theme/sdk.ts` | `@wocart/storefront/server` |
| Image URLs | `src/theme/utils/images.ts` | `mediaImageUrl` / `pictureOf` at `config.media` |

Everything else renders what those two hand it. A component that calls the
platform itself is a regression.

### Platform surface — do not touch from the theme layer

```
@wocart/storefront          ← the SDK: reads, actions, proxies, image helpers
@wocart/theme               ← the composition contract + Astro renderer
src/theme/sdk.ts             ← the one platform read seam
src/theme/utils/images.ts    ← the media-domain image binding
src/middleware.ts            ← action redirect (SDK PRG decision)
src/pages/api/**             ← same-origin proxies (SDK bindings)
```

If you want to change one of these it is a **platform change** (an SDK release),
not a theme change — stop and ask. A missing capability is an SDK change in
`@wocart/storefront`, never a local re-implementation. Reference data is part of
that line too: `WILAYAS` / `communesForWilaya` come from `@wocart/storefront`,
there is no `src/theme/data/`, and the commune bundle is parity-checked against
the server's seed rows. Everything under `components/`, `catalog/`, `content/`,
`styles/` and the `src/pages/*` templates is yours.

---

## 2. The two hard rules

### 2.1 Never hardcode a visible string

Every string a shopper can read lives in the locale packs —
`src/theme/content/<lang>/<area>.ts`, one file per area, typed per area under
`src/theme/content/types/`. The one flat `StoreFrontContent` is composed in
`src/theme/content/types.ts`, assembled per locale by
`src/theme/content/<lang>/index.ts`, and resolved at request time by
`resolveContent()` (`src/theme/content/index.ts`) from the store's configured
language and that language's overrides (`StoreConfig.contentOverrides`). Components read it from the `content` prop.

Adding a label = add the key to the area's **type** in `content/types/`, fill it
in **all three** locales' area files, then read it in the component — never type
the literal in markup.

```astro
{/* ❌ NO */}
<button>Add to Cart</button>

{/* ✅ YES */}
<button>{content.formSubmit}</button>
```

Miss a locale and it fails twice: the per-area type annotation (a compile error)
and `content/__tests__/packs.test.ts` (the three-locale parity guard).

### 2.2 Never hardcode a color, radius, font, or spacing value

The theme's tokens live in two places:

- **Static tokens** in `src/theme/styles/global.css` `:root` (`--clr-surface`,
  `--clr-border`, `--clr-text`, `--clr-text-2`, `--safe-top`, `--safe-bottom`).
- **Merchant-overridable tokens** injected at request time by `BaseHead.astro`
  from `getStoreContext().config` (`--clr-primary`, `--clr-accent`, `--clr-bg`,
  `--font-body`) — these reflect the merchant's choice in the dashboard.

Components reference `var(--clr-primary)`, never `#7c3aed`. Same for radius
(`var(--radius-card)`, `var(--radius-input)`, `var(--radius-btn)`), shadows
(`var(--shadow-md)`, `var(--shadow-primary)`) and easings
(`var(--animate-spring)`).

```css
/* ❌ NO */
.btn { background: #7c3aed; border-radius: 12px; }

/* ✅ YES */
.btn { background: var(--clr-primary); border-radius: var(--radius-btn); }
```

This rule is what lets one theme render any merchant's brand —
purple-and-orange, green-and-red, blue-and-yellow — without re-skinning a
component.

### 2.3 The composition rules (the theme contract)

Home is *composed* through `@wocart/theme`, not hardcoded in the page:

1. **Definitions are code; instances are data.** A definition
   (`catalog/home/<type>.def.ts`) says what a section *can* be — its type, label,
   fields and `load`. The document (`pages/home.page.json`) says which sections
   exist and what they say.
2. **A section never reads the platform itself.** The catalog's keyed `load`
   declares the read; the page owns ONE `createReadCache()` per render, so N
   sections still cost one catalog + one categories request. A section calling
   `products.list()` is a regression (guard: `product-zero.test.ts`).
3. **Adapt components, never rewrite them for the contract.** A definition wraps
   the existing `.astro` file — the component works with or without it.
4. **Fixed chrome stays out of page data.** Header, footer and nav are the
   theme's shell, not composition.

Add a section = add `catalog/home/<type>.def.ts` + register it in `theme.ts`.

5. **The editor reads the manifest, never the theme.** `/wocart-theme.json`
   (prerendered from `theme.ts` by `themeManifestEndpoint`) carries every
   section, field, preset, setting and text pack. A field an editor can fill
   is declared once, in the definition, with the SDK's kinds: copy (`text`
   with a `contentKey`), links (`url`), counts (`number`), images (`image` —
   a media key, resolved with `mediaKeyUrl`), formatted text (`richtext` —
   rendered with `richTextToHtml` into `.rich-description`), repeatable items
   (`list`) and store picks (`menu`, `collection`, `product`, `category`).
   Select options carry their editor words in `optionLabels`.

6. **An editor previews drafts on the real storefront.** `/wocart-preview`
   renders the surface the SDK's `previewTarget` picks — the page the draft
   edits, for the resource its path names or the store's first of its kind —
   from the draft an editor sends, with each section marked for the editor
   and the SDK's bridge loaded. A section with browser behavior binds it with
   `bindEach` (`@wocart/theme/lifecycle`), which binds a re-rendered section
   once more and never twice. When the whole page is swapped, the bridge fires
   `astro:page-load`, so page behavior mounted with `onEachPage` mounts again,
   as after a soft navigation.

7. **A publish shows at once.** Pages are cached at the edge (route rules
   in `astro.config.mjs`); after a merchant publishes, the Cloud calls
   `/wocart-revalidate` and the theme drops every page tagged `"pages"`. A
   new cached route takes that tag too, or it shows the old publish until
   it expires.

---

## 3. Design system

### Palette

The merchant picks a `primaryColor` and `accentColor` in the dashboard. Defaults
read well before any customisation.

| Token           | Default           | Source                   | Usage                                      |
|-----------------|-------------------|--------------------------|--------------------------------------------|
| `--clr-primary` | `#7c3aed`         | `BaseHead.astro` runtime | Brand color — buttons, badges, links       |
| `--clr-accent`  | `#f59e0b`         | `BaseHead.astro` runtime | Secondary highlight — sale stripes, hovers |
| `--clr-bg`      | `#f8f8f8`         | `BaseHead.astro` runtime | Page background                            |
| `--clr-surface` | `#ffffff`         | `:root` (static)         | Cards, input backgrounds                   |
| `--clr-border`  | `rgba(0,0,0,.06)` | `:root` (static)         | Hairlines                                  |
| `--clr-text`    | `#0f172a`         | `:root` (static)         | Body text, headings                        |
| `--clr-text-2`  | `#64748b`         | `:root` (static)         | Captions, secondary text                   |

> **Accessibility note** — `global.css` carries explicit guidance on safe
> `--clr-primary` values. Keep contrast ≥ 4.5:1 against white. See the comment
> block above `:root` in `global.css` for recommended hex values.

### Typography

- **Default:** `Cairo` (a strong AR + Latin sans, free Google Font), loaded with
  **Plus Jakarta Sans** as the Latin fallback, then system-ui.
- **Override:** a merchant may supply their own `fontFamily` / `fontUrl` via the
  store config; `BaseHead.astro` rewrites `--font-body` and the Google Fonts
  `<link>` accordingly.

The theme stays **single-font**. A separate display face would fight the
Arabic/Latin balance — use weight changes (400 / 600 / 800) for hierarchy.

### Radius — friendly, rounded

Soft, generous corners are this theme's signature.

- `--radius-card`  `1.25rem` (20px) — product cards, sections
- `--radius-input` `1rem`    (16px) — form fields, dropdowns
- `--radius-btn`   `1rem`    (16px) — buttons

Don't go below 12px or above 24px. Below feels cold; above feels cartoonish.

### Shadow

- `--shadow-sm`      `0 1px 2px rgba(0,0,0,.04)` — hairline lift
- `--shadow-md`      `0 4px 12px rgba(0,0,0,.05)` — card resting state
- `--shadow-lg`      `0 12px 24px rgba(0,0,0,.08)` — modal, hover
- `--shadow-primary` `0 8px 24px color-mix(... primary 25%)` — CTAs glow with the
  merchant's brand color

### Motion

- `--animate-spring` — `cubic-bezier(0.175, 0.885, 0.32, 1.1)`. The signature
  easing: snappy with a tiny overshoot — feels app-y. Use for hover states,
  button press, modal open.

---

## 4. Layout decisions

### Languages first

The theme defaults to **Arabic** (`lang="ar"`, `dir="rtl"`). Components must work
bidirectionally:

- Use logical CSS properties — `padding-inline`, `margin-inline-start`,
  `inset-inline-start` — never `padding-left` / `padding-right`.
- Tailwind: prefer `ps-*` / `pe-*` / `start-*` / `end-*` over `pl-*` / `pr-*` /
  `left-*` / `right-*`.
- Direction-implying icons (back arrows, chevrons) flip when `dir="rtl"` — most
  do via `transform: scaleX(-1)` on the SVG, or `rotate-180` in the existing
  RTL-aware components.

### Mobile-first with bottom nav

The theme ships a **mobile bottom-tab navigation** (`MobileNav.astro`) — it feels
native on a phone. Keep it. On desktop it is hidden and the top header takes over.

### Pages

- **Home (`/`)** — hero, trust strip, featured / new arrivals, categories,
  footer. Sections live inside friendly rounded cards.
- **Listing (`/products`, `/category/[slug]`)** — 2-col grid on mobile, 3-col on
  tablet, 4-col on desktop. Cards are rounded with `--shadow-md`.
- **Product detail (`/products/[slug]`)** — gallery left (sticky on desktop,
  swipeable on mobile), info + form right. Order form is inline below the fold on
  mobile.
- **Thank you** — friendly confirmation with "what happens next" steps.

---

## 5. Component inventory

```
src/theme/
├── catalog/                 ← the composition catalog (see §2.3)
│   ├── home/<type>.def.ts   ← one definition per home section
│   └── shared.ts            ← read keys + copyOverrides
├── pages/                   ← home.page.json (the page document)
├── content/                 ← ar/ en/ fr/ (per-area strings) + types/ + copy.ts
├── components/
│   ├── home/
│   │   ├── Hero.astro                 ← hero with CTAs + trust badges
│   │   ├── CategoryCards.astro        ← 4 category image cards (props)
│   │   ├── BestSellers.astro          ← featured products grid (props)
│   │   ├── HowItWorks.astro           ← 3-step COD trust section
│   │   ├── NewArrivals.astro          ← newest products grid (props)
│   │   ├── FeaturesBar.astro          ← icon trust strip
│   │   ├── WhatsAppCTA.astro          ← promo banner with CTA
│   │   └── CustomerTestimonials.astro ← review cards (props + own review fetch)
│   ├── layout/
│   │   ├── BaseHead.astro   ← <head>, fonts, runtime token injection
│   │   ├── Header.astro     ← top bar with brand + navigation
│   │   ├── Footer.astro     ← multi-column footer with trust badges
│   │   └── MobileNav.astro  ← bottom tab bar (the theme's signature)
│   ├── product/
│   │   ├── ProductCard.astro
│   │   ├── ProductGallery.astro
│   │   ├── ProductInfo.astro
│   │   ├── ProductDetailContent.astro
│   │   ├── ReviewsList.astro
│   │   └── ReviewForm.astro
│   ├── order/
│   │   ├── OrderForm.astro
│   │   ├── VariantSelector.astro
│   │   ├── OfferTiers.astro
│   │   ├── CustomerFields.astro
│   │   └── OrderSummary.astro
│   └── ui/
│       └── Select.astro     ← carries the dropdown visibility fix
└── utils/                   ← money.ts, images.ts, seo.ts, related-products.ts
```

> **Boundaries.** Home sections are presentational — the page
> (`src/pages/index.astro`) owns the one catalog/category read, and the section
> definitions live in `catalog/`. Screen-value projections come directly from
> `@wocart/storefront` (`getProductView`, `getProductListView`, and
> `getOfferTierView`). `utils/money.ts` only binds the SDK money formatter to
> this theme's locale and symbol choice.

---

## 6. The platform boundary

```
@wocart/storefront          ← the SDK: reads, actions, proxies, image helpers
src/theme/sdk.ts             ← the one platform read seam
src/theme/utils/images.ts    ← the media-domain image binding
src/middleware.ts
src/content.config.ts
src/pages/api/**
```

The data layer is platform-owned. If you think you need to change something
there, that is a platform change, not a theme change. A missing capability is an
SDK change in `@wocart/storefront`, never a local re-implementation.

Reference data is part of that line: `WILAYAS` and `communesForWilaya` come from
`@wocart/storefront`, and there is no `src/theme/data/` to edit. The commune
bundle is parity-checked against the server's seed rows before every SDK release,
so a corrected commune is a platform change on both sides, never a theme-side
patch.

---

## 7. Copy notes

- Three locales must stay in sync: `content/ar/`, `content/en/`, `content/fr/`.
  A per-area type enforces shape exactness — adding a key to one locale's area
  file without the others fails the build, and `content/__tests__/packs.test.ts`
  fails on any drift.
- Default language is Arabic (`lang="ar"`). The English pack is written for store
  owners reviewing copy or for English-speaking Algerian customers — not for
  international stores.
- Currency: `DZD` / `دج` (`StoreConfig.currencySymbol`).
- Phone validation: 10 digits starting `05` / `06` / `07`. Validated by
  `@wocart/storefront` (the phone schema), never in the theme.

---

## 8. Briefing for a contributor (or an AI agent)

You are working on **theme-00**, Wocart's reference theme. Its job is to be
**broadly useful** — a starting point any store can ship, and the worked example
other themes copy. That rules out styling choices that only suit one niche.

### DO NOT TOUCH

```
@wocart/storefront           ← the SDK owns reads, actions, proxies, images
@wocart/theme                ← the composition contract + renderer
src/theme/sdk.ts              ← the one platform read seam
src/theme/utils/images.ts     ← the media-domain image binding
src/middleware.ts             ← action redirect (SDK PRG decision)
src/content.config.ts
src/pages/api/**              ← same-origin proxies
astro.config.mjs              ← exception: only edit `integrations` if needed
wrangler.jsonc                ← Worker name + bindings
package.json deps             ← only add a dep if absolutely required
```

If you want to change one of these, it is a platform change. Stop and ask.

### YOUR JURISDICTION

```
src/theme/**                   ← every component, every style
src/theme/catalog/             ← the composition catalog (add sections here)
src/theme/content/{ar,en,fr}/  ← one file per area; all three locales in sync
src/theme/styles/global.css    ← static tokens; refine but don't break the system
src/pages/index.astro
src/pages/products/index.astro
src/pages/products/[slug].astro
src/pages/category/[slug].astro
src/pages/thank-you.astro
```

### THE RULES (re-read every commit)

1. **No hardcoded user-facing string.** Add the key to the area type in
   `content/types/`, fill it in **all three** locales, read it in the component.
   Grep your diff for a visible literal — if a shopper can read it, it is a
   violation.
2. **No hardcoded color, radius, or font value.** Use `global.css` `:root` tokens
   and the runtime variables `BaseHead.astro` emits. If you need a token that
   doesn't exist, add it to `:root` first. The merchant's `primaryColor` /
   `accentColor` / `fontFamily` flow through `--clr-primary` / `--clr-accent` /
   `--font-body` — respect that, never override it.
3. **Compose, don't hardcode.** New home sections are `catalog/home/<type>.def.ts`
   + registered in `theme.ts`, never markup inline in the page (§2.3).

### DESIGN BAR — what "theme quality" means here

The theme is the **safe default**. Don't ship a hero that only looks good for one
niche, don't pick fonts without AR + Latin coverage, don't choose accent
treatments that depend on a specific brand color. Every visual decision must work
at a beauty store, an electronics store, a supplements store and a general retail
store.

**Reference quality bar:** Shopify's default themes (Dawn, Refresh, Studio) —
niche-neutral but premium because they nail typography hierarchy, whitespace,
spacing rhythm, contrast and motion.

**RTL is first-class.** Test every component in `lang="ar" dir="rtl"`. A design
that assumes Latin left-to-right order breaks for most users.

**Mobile is the primary surface.** Algerian e-commerce traffic is 80%+ mobile.
The bottom nav is part of the theme's identity — keep it.

---

## 9. Data contract — what each page receives

Pages fetch via `getStoreContext()` and, through the one seam
(`src/theme/sdk.ts`), `storefront.products.get(slug)` etc. Your job is to render
what they pass to your components. **Do not fetch inside presentational
components — pass props.** The one documented exception is a section's catalog
`load`, which is where reads are declared; the page owns the read cache.

Key shapes (from `@wocart/storefront` — types + zod schemas):

- `Product` has `id, name, description, descriptionFormat ("text" | "html"),
  descriptionPlain, price, compareAtPrice, images[], variants[], offers[],
  inventory, trackInventory, …` — see §10 for the two description fields.
- `ProductVariant` has `id, price, compareAtPrice, inventory, variations:
  Record<string, string>` (e.g. `{"Size": "M", "Color": "Red"}`).
- `Offer` has `discountType: "free" | "free_shipping", triggerQuantity,
  rewardQuantity, …`
- `StoreConfig` has `name, currency, currencySymbol, primaryColor, accentColor,
  lang, reviewsEnabled, …`
- `StoreFrontContent` (from `src/theme/content/types.ts`) — the resolved language
  pack every component receives as `content`.

---

## 10. Rich descriptions — render, never parse

A description arrives in one of two formats, and the format is part of the
payload:

- `descriptionFormat: "text"` (or absent — every product that predates rich
  descriptions) → render it as **escaped text**, exactly as before. Never as
  markup, whatever it contains.
- `descriptionFormat: "html"` → the platform already sanitised it at the write
  chokepoint. Render it with `set:html` and do **not** re-sanitise, re-parse or
  escape it.

That trust is the contract: sanitising happens once, on the write path, in the
platform (`cod-shared/lib/rich-text.ts`) — so this theme, which is swappable and
imports nothing from the platform, never parses HTML. For `<meta>` and JSON-LD use
the product's `descriptionPlain` (tags stripped, entities decoded); the SDK's
`productMeta` and `productStructuredData` already do.

`src/theme/components/product/ProductDescription.astro` is the one place that
branch lives. Every tag the allow-list permits is styled under
`.rich-description` in `global.css`, and `rich-description.test.ts` fails when a
permitted tag has no style — add the style when the platform widens the list.

The allow-list (a mirror of `RICH_TEXT_TAGS` in `cod-shared/lib/rich-text.ts`; a
test compares the two, so keep the shape):

```
Text      p br hr strong b em i u s strike sub sup code pre
Headings  h2 h3 h4 h5 h6
Lists     ul ol li blockquote
Links     a
Media     img figure figcaption
Highlight mark
Tables    table thead tbody tfoot tr th td
```

Attributes are per tag, never global: `a` keeps `href`/`title` (`https`, `http`,
`mailto`, `tel` only — `rel` and `target` are forced by the platform), `img` keeps
`src`/`alt`/`width`/`height` (`src` must be `https:`), `td`/`th` keep
`colspan`/`rowspan`/`scope`/`headers`. Three features survive as attributes:
text alignment (an inline `text-align` on `p`/headings), the highlight colour
(`mark` with a hex or `rgb()` `background-color`), and checklists
(`ul[data-type="taskList"]` with `li[data-type="taskItem"]` + `data-checked`).
Every other `on*` handler, `style`, `class`, `id` and `data-*` is dropped, and
HTML comments are removed.

---

## 11. TECHNICAL GOTCHAS — already paid for in production

These are real bugs the theme shipped fixes for. Do not re-introduce them.

1. **Client-side navigation (`<ClientRouter />`) is on, page by page.** A page
   passes `softNavigation` to `StoreLayout`. Checkout and the thank-you page
   pass `false`, and so do product and landing pages when Turnstile is enabled:
   its widget renders once per document. Every POST form carries
   `data-astro-reload`, and so does every language link. An earlier version
   of the router was removed after `/_astro/*.js` chunks were served with an
   empty Content-Type; the release pipeline now sets and verifies the
   Content-Type of every asset. Changing this policy needs the owner's approval.

2. **Page scripts bind through `onEachPage`** (`@wocart/theme/lifecycle`).
   A soft navigation swaps the body without firing `DOMContentLoaded`, so a
   script that binds only there goes dead on the second page. `onEachPage` runs
   `boot` on the first load and after each navigation, and runs the teardown
   it returns before the old body is swapped out. An inline script that binds
   per page carries `data-astro-rerun`, or Astro skips it on a second visit.

3. **Dropdown visibility uses inline `display: none`, NOT a `.hidden` class.**
   Tailwind class ordering can leave `.hidden`-classed absolutely-positioned
   divs visible and click-trapping the form underneath. Reference:
   `src/theme/components/ui/Select.astro`. Carry the same pattern into any new
   dropdown / popover / drawer.

4. **No `transition:name=*` / `transition:persist` directives.** Same reason as
   #1.

5. **Don't add a `_headers` file in `public/`.** It doesn't apply to programmatic
   Worker deploys via the Cloudflare API path.

6. **D1 has no transactions in this codebase.** Sequential awaits only. (You
   shouldn't be touching DB code anyway — see §8 DO NOT TOUCH.)

7. **Browser scripts use Astro's native `<script src>` processing.**
   Browser scripts use Astro's native `<script src>` processing. Scripts are attached by the pages/components that require them (e.g. `<script src="../../theme/scripts/product.ts"></script>`). The page contract tests (`src/theme/__tests__/contracts/page-contracts.test.ts`) protect required page/script relationships (e.g. `track-abandonment.ts`, `turnstile-field.ts`). No custom script registry or `pageScripts()` abstraction is required.

---

## 12. Tailwind notes

- The project uses **Tailwind v4** via `@tailwindcss/vite` and
  `@import "tailwindcss"` at the top of `global.css`.
- The theme uses the `@theme {}` block to bridge Tailwind utility classes (e.g.
  `bg-primary`, `text-primary`) to runtime CSS variables. That's fine — the
  `@theme` mapping points at variables `:root` (or BaseHead's runtime block)
  defines.
- You may use Tailwind utilities for layout (`flex items-center gap-4`,
  `grid-cols-3`) and the `@theme`-bridged colors (`bg-primary`, `text-primary`).
  Do **not** use Tailwind raw colour utilities (`bg-purple-500`, `text-red-600`).
  Always go through the token.

---

## 13. Quality bar before you say "done"

A page is done when:

- ✅ `npm run validate:all` passes (no hardcoded visible strings, no hardcoded
  colors/radius/fonts/spacing).
- ✅ `npx astro check` reports **0 errors / 0 warnings**.
- ✅ `npm test` is green — including the boundary guards (`product-zero.test.ts`,
  `sdk-boundary.test.ts`) and the content parity guard (`packs.test.ts`).
- ✅ The page renders cleanly in `npm run dev` **and** `npm run build`.
- ✅ DevTools console is empty on a freshly-loaded product page.
- ✅ All clickable elements respond on first click; the gallery works on touch;
  the bottom nav active state updates on navigation.
- ✅ The page renders correctly in **all three** of `lang=ar/dir=rtl`,
  `lang=fr/dir=ltr`, `lang=en/dir=ltr`. Spot-check the order form, the gallery
  and the navigation.
- ✅ Lighthouse mobile on the PDP is ≥ 85 Performance and ≥ 95 Accessibility.
- ✅ This `THEME_GUIDE.md` reflects any new component you added — every component
  gets a one-line entry in §5.

## 14. Where to look when stuck

- **Need a component pattern?** The existing components cover most cases. Read
  first, mirror the style.
- **Need to know what an action returns?** Read `src/actions/index.ts` and the
  SDK's `PlaceOrderResult` (`@wocart/storefront/astro`).
- **Need an example of token usage?** `Header.astro`, `Footer.astro`,
  `OrderForm.astro` are token-clean. Match that style.
- **Need to add a composed section?** `src/theme/catalog/home/` — copy an
  existing `*.def.ts`, then register it in `theme.ts`.
- **Need the platform contract?** `USAGE.md` in the installed `@wocart/storefront` and its
  shipped types.

## 15. What "improving the theme" looks like

Good moves:

- Tighten typography rhythm and vertical spacing
- Add motion polish (more uses of `--animate-spring`)
- Improve the empty / error / loading states (often skipped)
- Improve PDP conversion (sticky CTA on mobile, trust strip below the buy button,
  scarcity / social proof when the data exists)
- Clean up token-violating inline styles you find while working
- Add a new composable section to the catalog (the documented way to extend Home)

Bad moves:

- Replacing the Cairo font with a Latin-only display face (breaks Arabic stores)
- Swapping rounded cards for sharp ones (that's a different theme's identity)
- Removing the bottom nav (it is this theme's identity)
- Adding a hero pattern that only works for one niche
- Hardcoding markup into `index.astro` instead of adding a catalog definition
- Reading the catalog inside a section instead of in its `load`

When in doubt, ask: *"Does this still work for a beauty store, an electronics
store, a supplements store and a general retail store, in three languages?"* If
the answer is no, it belongs in a different theme.
