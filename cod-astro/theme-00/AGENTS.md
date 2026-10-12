# theme-00 — repository instructions for coding agents

`cod-astro/theme-00` is CodFlow's **reference theme** — the complete storefront
theme (Astro 7, Cloudflare Workers, AR/FR/EN) that shows how a CodFlow theme is
built on the platform's SDKs (`@codflow/storefront` + `@codflow/theme`). New
themes start from this one; it is the worked example.

- **Read [`THEME_GUIDE.md`](./THEME_GUIDE.md) first** — structure, the two hard
  rules, the composition rules, the design system and the production gotchas.
- Read the root `AGENTS.md` too — this file only overrides what differs here.

## Layout

- `src/core/` — **deleted** (S10's removal pulled forward). Platform behavior
  comes from `@codflow/storefront` through the copy's seams: `src/theme/sdk.ts`
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
  and lockfile; the theme workspace itself follows the single-root-lockfile
  rule.
- `wrangler.jsonc` — mechanics only (`name`, `main`, `compat`, `assets`). It
  carries **no `routes`**: a store's domain is set at deploy time by the
  platform, never committed here (the repo rule for wrangler configs is
  "live resource IDs are never committed"). The Worker name is
  `codflow-os-theme00` so a stray deploy cannot land on a live store.

## Commands

Install at the repo root (`npm ci`), then run inside this directory:

```sh
npm run dev         # astro dev :4321 (expects cod-server on :8787)
npm run build       # astro build
npm test            # vitest --run (unit/property tests)
npx astro check     # typecheck + diagnostics
npm run validate    # string + style validators, then build
```

There is no `typecheck` script; `npx astro check` is the typecheck here. The
dashboard Worker also defaults to :4321 — run one on `--port 4322` when both
are up. Target this package by its workspace name, `cod-astro-theme-00`.

The home surface imports `@codflow/theme/astro` **by package name**, so the
workspace dists must exist first — after a fresh install run
`npm run build --workspace @codflow/storefront && npm run build --workspace
@codflow/theme` (dev, tests, `astro check` and the build all read them; a
stale `dist/astro/InstanceView.astro` fails confusingly).

## Definition of done

A theme is not finished until this exact sequence passes — the same gates CI
runs in the `theme-00` job (`.github/workflows/ci.yml`), in this order:

```sh
npm run build --workspace @codflow/storefront   # the dists the theme imports
npm run build --workspace @codflow/theme
cd cod-astro/<theme>
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
  `@codflow/storefront`, imported by package name — never a repository-relative
  path — and theme code never imports `cod-shared`.
- An SDK defect is fixed in `cod-sdk/storefront/` with a regression test there;
  never solved by adding a second implementation in this copy.
- All user-facing text needs AR/FR/EN translations and must keep RTL working.
- The theme stays swappable: a new theme is a new folder, not edits to core.
- No commits or pushes without the owner's explicit request.

## Conventions & traps

- **No hardcoded user-facing strings** — add content keys to the language packs.
- **No hardcoded design tokens** (colors, radii, fonts) in component styles.
  See `THEME_GUIDE.md`.
- The `"overrides": { "vite": "^8.2.2" }` pin lives in the **root**
  `package.json` (npm ignores overrides inside workspace members) and is
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
- `MEDIA_DOMAIN` is optional; unset, the image optimizer passes URLs through
  unchanged.
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
- **Scripts here self-initialise on import** (`product.ts`, `cart-ui.ts`,
  `turnstile-field.ts`), because ClientRouter was removed and `astro:page-load`
  never fires. A layout that *also* calls the init function binds every handler
  twice — one tap adding two items. Import for side effect; `initCart()` and
  `initCheckout()` are idempotent per root and return a teardown.
- **Every page that renders the customer form must load
  `track-abandonment.ts`.** Forgetting it loses the merchant's callback leads
  silently. `src/theme/__tests__/contracts/page-contracts.test.ts` enforces this for every page that
  loads `otp-step.ts`.
- The same-origin proxies in `src/pages/api/*` validate with the **SDK's**
  schemas and **Zod strips unknown keys** — a field missing from an SDK schema
  never reaches cod-server, however correct the caller is. Fix the schema in
  `cod-sdk/storefront/`, never with a local copy.
- **Product Zero boundaries (2026-09-30).** The homepage owns its data graph —
  as of **Phase 5 (2026-10-01)** through the catalog's keyed `load`s
  (`src/theme/catalog/`) behind the ONE `createReadCache()` in
  `pages/index.astro`, not through
  direct calls in the page; home sections still take typed props — a section
  that reads the catalog itself is a regression. Screen-value projections
  (`getProductView`, `getProductListView`, and `getOfferTierView`) come directly
  from `@codflow/storefront`. Money goes through `src/theme/utils/money.ts`,
  which only binds the SDK formatter to the theme's locale/symbol choice; no
  other file calls `toLocaleString`, re-derives a default variant, or hardcodes
  a stock threshold.
  `src/theme/__tests__/guards/product-zero.test.ts` guards all of it, and
  `docs/history/PRODUCT_ZERO_AUDIT.md` holds the platform-vs-theme classification
  of every surface — update that document when a boundary moves.
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
  home sections render via `@codflow/theme/astro`'s `InstanceView`, driven by
  `src/theme/catalog/` (definitions: one `*.def.ts` per section, assembled by
  `src/theme/theme.ts`) + `src/theme/pages/home.page.json` (instances). Rules
  that keep it boring: adapt components, never rewrite them
  for the contract; keep fixed chrome (`StoreLayout`) out of page data; new
  reads go through the catalog's keyed `load`s + the page's ONE
  `createReadCache()` (`catalog.products` shared by three sections — proven;
  see `__tests__/contracts/home-adsorption.test.ts`); copy fields use the
  `contentKey` bridge (`copyOverrides` in `catalog/shared.ts`); other surfaces
  are NOT
  migrated — do not copy the pattern to them without a slice. Consumption is
  by package name; `dist` must be built first (see Commands). Design + report:
  `cod-sdk/theme-sdk/15-theme-00-home-adsorption.md`,
  `cod-sdk/theme-sdk/16-theme-00-home-adsorption-report.md`.
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
  `content_json` is ignored by design.
