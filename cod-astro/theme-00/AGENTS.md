# theme-00 — repository instructions for coding agents

`cod-astro/theme-00` is CodFlow's **reference theme** — the complete storefront
theme (Astro 7, Cloudflare Workers, AR/FR/EN) that shows how a CodFlow theme is
built on the platform's SDKs (`@wocart/storefront` + `@wocart/theme`). New
themes start from this one; it is the worked example.

- **Read [`THEME_GUIDE.md`](./THEME_GUIDE.md) first** — structure, the two hard
  rules, the composition rules, the design system and the production gotchas.
- Read the root `AGENTS.md` too — this file only overrides what differs here.

## Layout

- `src/core/` — **deleted** (S10's removal pulled forward). Platform behavior
  comes from `@wocart/storefront` through the copy's seams: `src/theme/sdk.ts`
  (reads), `src/theme/utils/images.ts` (image URLs), and the thin bindings in
  `src/actions/`, `src/middleware.ts`, `src/pages/api/*`. Do not recreate a
  local core layer — a missing capability is an SDK change.
- `src/theme/` — the theme layer: components (home/, product/, listing/,
  order/, cart/, chat/, layout/, ui/), layouts, styles, runtime (store
  context), content (AR/FR/EN string packs), bridges (SSR ↔ browser contracts
  and island prop picks), plus `catalog/` (the Home component catalog —
  definitions are code: one `*.def.ts` per section + `shared.ts`, assembled by
  `theme.ts`) and `pages/` (the Home page document,
  `home.page.json` — instances are JSON). Customization lands here.
- `public/`, `scripts/` — static assets and repo-owned validator scripts.
- `lighthouse-tests/` — deliberately separate tool with its own package.json
  and lockfile.
- `wrangler.jsonc` — mechanics only (`name`, `main`, `compat`, `assets`). It
  carries **no `routes`**: a store's domain is set at deploy time by the
  platform, never committed here (the repo rule for wrangler configs is
  "live resource IDs are never committed"). The Worker name is
  `codflow-os-theme00` so a stray deploy cannot land on a live store.

## Commands

Theme-00 is **not a workspace**: it installs `@wocart/*` from the npm
registry at exact versions, with its own lockfile, exactly like a theme
written outside this repository. Run everything inside this directory:

```sh
npm ci              # this theme's own lockfile
npm run dev         # astro dev :4321 (expects cod-server on :8787)
npm run build       # astro build
npm test            # vitest --run (unit, contract and guard tests)
npx astro check     # typecheck + diagnostics
npm run validate    # string + style validators, then build
```

There is no `typecheck` script; `npx astro check` is the typecheck here. The
dashboard Worker also defaults to :4321 — run this theme on `--port 4322` when
both are up. An SDK change reaches this theme only through a release: publish
it, then pin the new exact version here (the SDK maintainers run this theme
against the packed SDKs before that).

## Definition of done

A theme is not finished until this exact sequence passes — the same gates CI
runs in the `theme-00` job (`.github/workflows/ci.yml`), in this order:

```sh
cd cod-astro/<theme>
npm ci
npx astro check      # 0 errors (hints are advisory)
npm test             # includes the structural guard tests in __tests__/guards/
npm run validate:all # string + style rules
npm run build
```

The guard tests are **part of `npm test`**, not a separate step: they are
`*.test.ts` under `src/theme/__tests__/guards/`, and they assert the boundary
structure (one SDK adapter, one store-context acquisition point, the server-island
payload budget, the icon allowlist, catalog reads owned by definitions). A new
theme copies that pattern rather than inventing its own enforcement — the gates
above are what turn a boundary claim into a build failure.

A theme should also assert its own catalog against its own content pack, so a
`contentKey` typo fails a test rather than silently rendering a component's
built-in default:

```ts
expect(validateThemeDefinition(theme, { contentKeys: Object.keys(pack) })).toEqual([]);
```

## Boundaries

- Keep engine logic out. New platform behavior must come from
  `@wocart/storefront`, imported by package name — never a repository-relative
  path — and theme code never imports `cod-shared`.
- An SDK defect is fixed in `@wocart/storefront`, with a regression test there;
  never solved by adding a second implementation in this copy.
- All user-facing text needs AR/FR/EN translations and must keep RTL working.
- The theme stays swappable: a new theme is a new folder, not edits to core.
- No commits or pushes without the owner's explicit request.

## Conventions & traps

- **Every internal link goes through `Astro.locals.store.href(path)`** (ADR
  0005, phase D): a shopper on `/fr/…` must stay in French. A bare
  `href="/products"` fails `store-context.test.ts`. Links merchants type into a
  section (`url` fields) go through it too; external URLs and fragments pass
  through unchanged. Browser scripts read server-rendered hrefs (e.g. the cart's
  `data-checkout-href`), never build one.
- **Pages and components read through `Astro.locals.store.client`** — the
  request's SDK client, in its language. Only `src/theme/sdk.ts`, the store
  runtime, endpoints (`/api/*`) and actions create clients.
- **Server islands take the language of the page that loaded them** (its
  `Referer`); the middleware never redirects or rewrites `/_server-islands/*`.

- **No hardcoded user-facing strings** — add content keys to the language packs.
- **Counts and placeholders go through `message()`** (`src/theme/content/messages.ts`),
  never `.replace("{n}", …)`. A count is a plural message — one key per CLDR
  form (`lowStock_one`, `lowStock_few`, …) — and each language carries exactly
  the forms its grammar uses (Arabic six). `packs.test.ts` checks them.
- **No hardcoded design tokens** (colors, radii, fonts) in component styles.
  See `THEME_GUIDE.md`.
- This theme's `package.json` carries its own `"overrides": { "vite": … }`
  pin (the root's does not reach a non-workspace package), and it is
  load-bearing: it keeps a single Vite major across astro/vitest/plugins.
  Removing it reintroduces a dev-server boot crash; bump it together with
  astro's Vite major. `npm ls vite` must show one version.
- **Server islands take copy *picks*, never the pack.** Astro encrypts island
  props into the island request URL; the browser caps URLs at 2048 bytes and,
  past the cap, Astro switches to an uncacheable POST (docs.astro.build →
  Server islands → Caching). `RelatedProducts`/`ReviewsIsland` therefore take a
  `copy: …Copy` pick from `src/theme/bridges/island-props.ts`, and their inline scripts
  get single labels through `define:vars`, never the whole pack.
  `src/theme/__tests__/guards/server-islands.test.ts` pins both the limit and every pick's size.
- **Browser scripts use Astro's native `<script src="...">` processing.**
  Scripts are attached directly by the pages/components that require them (e.g.
  `<script src="../../theme/scripts/product.ts"></script>`). The page contract
  tests (`src/theme/__tests__/contracts/page-contracts.test.ts`) protect required
  page/script relationships (e.g. `track-abandonment.ts`, `turnstile-field.ts`).
  Do NOT introduce a custom script registry, global bundle, or `pageScripts()`
  abstraction.
- `ASTRO_KEY` (repo-root `.env`, build-time) keeps server-island props
  decryptable across deploys while pages are CDN-cached. Generate it once with
  `npm run key:create`; `npm run deploy` builds with it and warns when it is
  missing. Hosted builds (Vercel/CI) must set it in the build environment.
- `COD_SERVER_URL` is never set in `wrangler.jsonc` — `npm run deploy`
  (scripts/deploy.mjs) injects it at deploy time from the repo-root `.env`
  and refuses a localhost value without `--force-local`. Local dev reads it
  from this package's `.dev.vars`. Real secrets go in `.dev.vars` (gitignored)
  or `wrangler secret put` — never in `wrangler.jsonc`.
- Images need no variable: the store's config carries its media delivery
  (`config.media`), which `utils/images.ts` and the image service read.
- `WOCART_PREVIEW_KEY` is optional: the editor's preview public key (an
  Ed25519 JWK, a secret like the others). Unset, `/wocart-preview` is a 404.
- **astro-icon uses an explicit allowlist** (`icon({ include: { heroicons: […] } })`
  in `astro.config.mjs`). An icon used in markup but missing from it throws
  *at request time* — `astro check`, the validators and the component tests all
  pass, and the page 200s with an empty body. `src/theme/__tests__/guards/icon-allowlist.test.ts`
  guards both directions; add the name to the list in the same commit.
- **Tailwind v4 compiles `translate-x-*` to the `translate` property, not
  `transform`.** Setting `element.style.transform` from a script does not
  override it. `rtl:` is also **not** a configured variant here, so
  `rtl:-translate-x-full` compiles to nothing. Both bit the cart drawer: it
  un-hid one full width off-screen and never appeared. Open/closed geometry
  belongs in CSS keyed on a data attribute — see `CartDrawer.astro`.
- **Page scripts bind through `@wocart/theme/lifecycle`** — `onEachPage` for a
  page's behaviour, `bindEach` for each element of a kind (also re-run when an
  editor's preview swaps a section in) — on the first load and after every
  client-side navigation. No script names the swap events itself
  (`client-navigation.test.ts`). A module binds once on
  import, so a layout that *also* calls the init function binds every handler
  twice — one tap adding two items. Import for side effect; `initCart()`,
  `initCheckout()` and `initProductPage()` are idempotent per root and return a
  teardown. Pages that render Turnstile opt out of client-side navigation.
- **Every page that renders the customer form must load
  `track-abandonment.ts`.** Forgetting it loses the merchant's callback leads
  silently. `src/theme/__tests__/contracts/page-contracts.test.ts` enforces this for every page that
  loads `otp-step.ts`.
- The same-origin proxies in `src/pages/api/*` validate with the **SDK's**
  schemas and **Zod strips unknown keys** — a field missing from an SDK schema
  never reaches cod-server, however correct the caller is. Fix the schema in
  `@wocart/storefront` (an SDK release), never with a local copy.
- **Product Zero boundaries (2026-09-30).** The homepage owns its data graph —
  as of **Phase 5 (2026-10-01)** through the catalog's keyed `load`s
  (`src/theme/catalog/`) behind the ONE `createReadCache()` in
  `pages/index.astro`, not through
  direct calls in the page; home sections still take typed props — a section
  that reads the catalog itself is a regression. Screen-value projections
  (`getProductView`, `getProductListView`, and `getOfferTierView`) come directly
  from `@wocart/storefront`. Money goes through `src/theme/utils/money.ts`,
  which only binds the SDK formatter to the theme's locale/symbol choice; no
  other file calls `toLocaleString`, re-derives a default variant, or hardcodes
  a stock threshold.
  `src/theme/__tests__/guards/product-zero.test.ts` guards all of it.
- **The home document is the store's saved one, or the shipped default
  (Phase 6, 2026-10-01).** `index.astro` reads `store.pageData.get("home")`
  and hands the result to `src/theme/pages/home-document.ts`
  (`resolveHomeDocument`): saved wins; absent / invalid / zero type overlap
  renders the shipped `home.page.json`. The runtime **never writes**
  documents — Codflow Cloud Studio does, through the control plane (slices
  19/20/21). Seed a local document with `npm run db:seed:page-document --
  --file=…` from cod-server. `sdk.ts` forwards degraded reads to
  `console.warn` (the only place the theme observes them).
- **Home is composed through the theme contract (Phase 5, 2026-10-01).** The
  home sections render via `@wocart/theme/astro`'s `InstanceView`, driven by
  `src/theme/catalog/` (definitions: one `*.def.ts` per section, assembled by
  `src/theme/theme.ts`) + `src/theme/pages/home.page.json` (instances). Rules
  that keep it boring: adapt components, never rewrite them
  for the contract; keep fixed chrome (`StoreLayout`) out of page data; new
  reads go through the catalog's keyed `load`s + the page's ONE
  `createReadCache()` (`catalog.products` shared by three sections — proven;
  see `__tests__/contracts/home-adsorption.test.ts`); copy fields use the
  `contentKey` bridge (`copyOverrides` in `catalog/shared.ts`). Every page a
  merchant edits is composed the same way: home, product, collection,
  category, catalog and text page, thank-you, landing, search, order
  tracking, checkout and contact, and the header and footer areas.
- **Every word a home section renders is editable (2026-10-12).** Section copy
  is a field whose `key` equals its `contentKey`; store-wide UI vocabulary
  ("View all", aria labels) stays in the pack. Links are `url` fields (the SDK
  rejects unsafe targets) and counts are bounded `number` fields, typed in the
  component with `Pick<InferProps<typeof definition>, …>`.
  `__tests__/contracts/editor-coverage-contracts.test.ts` fails on frozen copy,
  a renamed copy field, or a declared setting the component ignores;
  `home-settings-contracts.test.ts` proves the settings through the real
  renderer.
- **Languages (ADR 0005, 2026-10-12).** The store context carries `locale`
  and `fallbackLocales` (empty while a store serves one language: the pack is
  the right fallback); the home page passes both into the render context and
  the resolution scope. The catalog declares `locales: ["ar", "fr", "en"]`, and
  every editor label, group and surface label comes from
  `src/theme/catalog/labels.ts` in all three. Add a label there, never inline.
  `home-languages-contracts.test.ts` proves saved copy follows the store's
  language and that every label is translated.
- **The manifest is a build file (`/wocart-theme.json`).**
  `src/pages/wocart-theme.json.ts` is the theme's one prerendered page; the
  middleware lets prerendered pages through without resolving a store (there
  is no request store at build). `defineTheme` declares the three content
  packs (spread into plain objects) and the `home` surface with its page type
  and `pages/home.page.json`, so the manifest carries everything an editor
  shows. `__tests__/contracts/manifest-artifact.test.ts` pins it.
- **Images, rich text and lists come from the SDK's field kinds.** An image
  field stores a media key, resolved with `pickedPicture` (`utils/images.ts`,
  the SDK's `pictureOf`: its URL, alt text and focal point);
  rich text is rendered with `richTextToHtml` into `.rich-description`; a
  list's items carry their own ids. See the image banner, rich-text block,
  FAQ and featured product (`catalog/home/*.def.ts`,
  `__tests__/contracts/home-editor-sections.test.ts`).
- **A home document another theme wrote is not rendered**: its `theme`
  provenance names another key, so the shipped default renders
  (`home-document.ts`, reason `other-theme`).
- **An editor's preview is `/wocart-preview`** (`src/pages/wocart-preview.astro`,
  ADR 0009). The middleware is the SDK's `createStorefrontMiddleware`: given
  `PREVIEW` from `theme/sdk.ts`, it checks the editor's token with
  `WOCART_PREVIEW_KEY` (unset: 404) and builds the draft's store, which
  `storeContext` (`runtime/store.ts`) turns into this theme's context; a
  preview never runs a form action. The page renders
  surface the SDK's `previewTarget` picks — the template the draft names, for
  the resource its path names or the store's first of its kind, or the page an
  area is edited on — with `preview` set, so every section is marked and
  `PreviewBridge.astro` loads `@wocart/theme/preview`. A surface this theme
  does not compose is a 404. Never add a route rule that caches the path.
  `__tests__/contracts/preview-route.test.ts` pins the route, the headers and
  the bridge over its real markup.
- **A publish shows at once through `/wocart-revalidate`**
  (`src/pages/wocart-revalidate.ts`). CodFlow Cloud posts a signed token
  there after a publish, and the route — the SDK's `revalidateEndpoint`, as
  `revalidateRoute` in `theme/sdk.ts`, with the same `WOCART_PREVIEW_KEY` —
  drops every page cached under `PAGES_CACHE_TAG`. Every cached page route in
  `astro.config.mjs` must carry `PAGES_CACHE_TAG`, never the literal:
  `revalidate-route.test.ts` fails on one that does not. The middleware lets
  the route through without resolving a store.
- **The order form's outcome lives in `src/theme/pages/order-outcome.ts`.**
  Product, landing and checkout pages call `orderOutcome(...)`; it owns the
  thank-you query that `thank-you.astro` reads back with `readThankYou`. Do not
  rebuild the redirect URL in a page.
- **Guards share one collector, `__tests__/guards/theme-source.ts`:** shipped
  `.ts`/`.astro` under `src/`, never test code. Test support lives in
  `__tests__/support/`.
- **The catalog is split one file per section (DX slice, 2026-10-01).** Each
  definition lives in `src/theme/catalog/home/<type>.def.ts`, next to the model
  it describes; `src/theme/catalog/shared.ts` owns the read keys and the
  `copyOverrides` bridge; `src/theme/theme.ts` is only the assembler.
  Definitions are deliberately **outside** `src/theme/components/`: that
  directory is scanned as shopper-facing markup (the hardcoded-string rule) and
  guarded as "sections are presentational" — a definition *declares* reads, a
  component must not *make* them. Add a section = add
  `catalog/home/<type>.def.ts` + register it in `theme.ts`.
- **The content packs are split per area (DX slice, 2026-10-01).** `content/`
  holds one folder per locale (`ar/ en/ fr/`), each one file per area
  (`home.ts order-form.ts cart.ts reviews.ts otp.ts …`), plus a per-area type in
  `content/types/`; `content/types.ts` composes them into the one flat
  `StoreFrontContent`, and each `<lang>/index.ts` assembles that locale's pack.
  Rules: add a string to **all three locales** (the area file, same key) —
  `content/__tests__/packs.test.ts` fails if one locale drifts; a part file is
  annotated with its area type, so a missing or extra key is a compile error;
  `copy.ts` (island copy picks) and the dashboard override vocabulary still
  read the assembled flat pack, which is unchanged.
- **Copy is a typed prop, never a fallback.** A component that renders
  shopper-facing text takes the resolved pack (`content: StoreFrontContent`)
  and the pack is required wherever the component is shared; a
  language-specific default literal inside a component is the exact violation
  the string validator is weakest against. `resolveContent` accepts only
  string values for keys the pack declares — a nested or unknown shape in
  the store's per-language overrides is ignored by design.
- **The browser talks to the platform only through the SDK.** The order form
  and the basket quote with `createQuoter`; an unfinished checkout is tracked
  by `createBrowserAbandonedCheckoutTracker` and converted on the thank-you
  page by `convertAbandonedCheckout`; the review form runs on
  `createReviewSession`; an offer chosen piece by piece goes into the basket
  through `addSelections`, and AddToCart reports `addedLines`. The paths those
  call are the SDK's `STOREFRONT_API_PATHS` (`storefrontApiPath` fills a
  parameter), each mounted by one file under `src/pages/api/`;
  `sdk-boundary.test.ts` checks both ways and that no other file writes an
  `/api/` path.
- **The store's WhatsApp is the App's, reached one way.** Every WhatsApp link
  — the launcher, the footer, the home band, the contact card, the thank-you
  and tracking buttons — comes from `storeWhatsApp` (`utils/whatsapp.ts`, the
  SDK's `whatsAppContact` with this theme's words). The launcher's message is
  built on the server for the page: `StoreLayout` takes the page's product
  (`whatsapp={{ kind: "product", product }}`). No component writes a `wa.me`
  link or reads `config.whatsapp` (`sdk-boundary.test.ts`).
- **A store that cannot be read renders the SDK's shell** —
  `UNAVAILABLE_STORE`, the SDK's `unavailableStoreConfig`: nothing to buy,
  and an empty `id`. Never write a fallback config by hand.
- **Listings, search and following an order are the platform's.** Listings read
  `products.page` (the rows, the next page and the total) with `?sort=` from
  the SDK's `PRODUCT_SORTS`; `/search` is `products.search`; `/track-order`
  (the platform's page type, `?order=` fills the number) is an Astro Action
  on `lookupOrder` that a plain form posts.
- **What search engines read is the SDK's.** A product's title and
  description are `productMeta`, its JSON-LD `productStructuredData` written
  with `jsonLd`, and every page's canonical is `canonicalUrl` (its path in its
  language and its listing page, never a sort, a coupon or an ad's click id).
  A missing product, category, collection, text page or landing page returns
  `notFound(Astro)`.
- **Colours derive on the SDK's scheme marker.** Tokens are derived on
  `:root, .wc-scheme`; an element wearing a scheme carries `schemeClass(id)`
  and no marker of the theme's own (`color-schemes.test.ts`).
