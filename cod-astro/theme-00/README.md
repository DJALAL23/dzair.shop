# theme-00 — the CodFlow reference theme

theme-00 is CodFlow's **reference theme**: the complete storefront (Astro 7,
Cloudflare Workers, AR/FR/EN) built on the platform's SDKs —
`@wocart/storefront` (data) and `@wocart/theme` (composition). It is the
worked example every new theme starts from.

**Read [`THEME_GUIDE.md`](./THEME_GUIDE.md) before changing anything here** — it
is the theme contract: structure, the two hard rules, the composition rules, the
design system, and the production gotchas.

## Relationship to the rest of the monorepo

| Path | Role |
|------|------|
| `cod-server` | Backend engine — REST API, `/store/*` storefront API, webhooks, MCP |
| `cod-client-astro` | Merchant dashboard (Astro) |
| `cod-astro/theme-00` | **This package** — the reference theme, built on the SDKs |
| `wocart-sdk/storefront` | `@wocart/storefront` — the platform/data SDK it consumes |
| `wocart-sdk/theme` | `@wocart/theme` — the composition contract + Astro renderer |

Theme-00 consumes the SDKs **from npm**, exactly as an outside theme does:
`package.json` pins `@wocart/storefront` and `@wocart/theme` to exact
published versions and Theme-00 keeps its own `package-lock.json` — it is not
an npm workspace, so nothing links it to the SDK sources. Install it on its
own with `npm ci` in this folder. `npm run verify:sdks` at the repo root runs
this theme against freshly packed SDK tarballs before a release; after the
release, bump the pins (`wocart-sdk/README.md` → Releasing).

## What it does (today)

- Product catalog: home, listing, category, and product-detail pages
- COD order form with a wilaya-based shipping calculator, variant + offer support
- Product reviews (submitted and read through `cod-server`)
- Abandoned-order tracking (`POST /store/abandoned`) with the Meta Pixel
- Three locale packs: **Arabic, French, English** (RTL-first, default Arabic)
- Partner-overridable design tokens (colors, font) injected at request time
- Images resized by the store's own media delivery (ImageKit or Cloudflare), read from its config

The behavior above is implemented by `@wocart/storefront`, reached through the
theme's two seams: `src/theme/sdk.ts` (reads) and `src/theme/utils/images.ts`
(image URLs). The legacy `src/core/` engine is deleted; the theme layer
(`src/theme/`) stays theme-owned.

## Quick start

Prereqs: Node 22.12+, the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/),
and a running `cod-server` (the storefront reads all data from its `/store/*` API).

```bash
npm ci                           # at the repo root — installs all workspaces
npm run build --workspace @wocart/storefront   # dists the Home surface reads
npm run build --workspace @wocart/theme
cd cod-astro/theme-00
cp .dev.vars.example .dev.vars   # fill in your values
npm run dev                      # http://localhost:4321
```

> The storefront expects `cod-server` on `http://localhost:8787` (the default
> `COD_SERVER_URL`). The dashboard Worker also defaults to :4321 — run one on
> `--port 4322` when developing both at once.

## Environment variables

Defined in `astro.config.mjs` → `env.schema`, read from `.dev.vars` locally and
`wrangler secret put` in production.

| Variable | Required | Purpose |
|----------|----------|---------|
| `STORE_API_KEY` | yes | Per-store key sent as `X-Store-API-Key` to the `/store/*` API. Must match the key seeded into D1 (dev default: `codflow-dev-store-key`). |
| `COD_SERVER_URL` | yes | Base URL of the `cod-server` Worker (dev: `http://localhost:8787`). |
| `WOCART_PREVIEW_KEY` | no | The editor's public key (an Ed25519 JWK), set by CodFlow Cloud's deploy. It opens `/wocart-preview` for the editor, and lets `/wocart-revalidate` drop cached pages after a publish. Unset → both answer 404. |

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Astro dev server on `http://localhost:4321` |
| `npm run build` | Production build (`astro build`) |
| `npm run preview` | Build, then run the Worker locally via `wrangler dev` |
| `npm run deploy` | Build (with `ASTRO_KEY` from the repo-root `.env` when set), then deploy to Cloudflare Workers (`wrangler deploy`) |
| `npm run key:create` | Generate the `ASTRO_KEY` value for the repo-root `.env` (server-island prop encryption) |
| `npm test` | Vitest unit/property tests (`fast-check`) |
| `npm run validate:strings` | Check for hardcoded user-facing strings in components |
| `npm run validate:styles` | Check for hardcoded colors/radii/fonts in component styles |
| `npm run validate:all` | Both validators, then `astro build` |
| `npm run cf-typegen` | Regenerate `src/env.d.ts` from `wrangler.jsonc` |

## Project structure

```
src/
├── theme/               # Theme layer — everything customizable
│   ├── components/      #   home/, layout/, order/, product/, listing/, chat/, ui/
│   ├── content/         #   UI strings: one folder per locale (ar/ en/ fr/)
│   │   ├── ar|en|fr/    #     one file per area (home, order-form, cart, …)
│   │   └── types/       #     one type per area; types.ts composes StoreFrontContent
│   ├── bridges/         #   SSR ↔ browser contracts & island prop picks (product-page-data.ts, island-props.ts)
│   ├── runtime/         #   store.ts (UNAVAILABLE_STORE + the store context)
│   ├── catalog/         #   Home component catalog (definitions — code)
│   │   ├── home/        #     one *.def.ts per section (hero, best-sellers, …)
│   │   └── shared.ts    #     read keys + the copyOverrides bridge
│   ├── theme.ts         #   the catalog assembler (defineTheme → theme00)
│   ├── pages/           #   the Home page document (home.page.json — JSON)
│   ├── layouts/         #   StoreLayout.astro
│   ├── scripts/         #   browser behavior: product.ts, checkout.ts, cart.ts (+ tests)
│   ├── styles/          #   global.css (design tokens)
│   ├── sdk.ts           #   the one platform read seam (SDK client factory)
│   ├── types.ts         #   shared theme types (FieldErrors)
│   └── utils/           #   seo.ts, money.ts, related-products.ts, images.ts (media binding)
├── actions/             # placeOrder — thin binding over the SDK action
├── middleware.ts        # PRG decision — thin binding over the SDK middleware
├── content.config.ts    # Build-time collections (empty — data is fetched at request time)
└── pages/               # index, products/, category/, thank-you, api/* (SDK proxy bindings)
```

See [`THEME_GUIDE.md`](./THEME_GUIDE.md) for the two hard rules (no hardcoded
strings, no hardcoded design tokens), the design system, and the full component
inventory.

## Migration status (2026-09-30)

- **S5–S10 done (green):** reads go through the one SDK adapter; all eight
  `/api/*` routes, the order action, and middleware are thin SDK bindings; the
  legacy `src/core/` engine is deleted and the deletion is guarded by
  `src/theme/__tests__/guards/sdk-boundary.test.ts`.
- **Product Zero pass (2026-09-30):** the architecture audit + P0 refactor
  landed.
  The homepage owns its data graph (one catalog read, presentational sections),
  money and the commerce view each have one module, typed props replaced every
  `any`, dead components are deleted, and the four boundaries
  (platform/theme/config/content) are documented and guarded by
  `src/theme/__tests__/guards/product-zero.test.ts`.
- **Phase 5 — Home adsorption (2026-10-01):** the Home surface now renders
  through `@wocart/theme` + `@wocart/theme/astro` from
  `src/theme/pages/home.page.json` via the catalog in `src/theme/catalog/`
  (one `*.def.ts` per section, assembled by `src/theme/theme.ts`);
  all eight sections are unchanged components, the data graph still costs one
  catalog + one categories read per render (keyed `load`s + `createReadCache`),
  and behavior/copy parity is asserted by
  `src/theme/__tests__/contracts/home-adsorption.test.ts`. Design + report:
  [`cod-sdk/theme-sdk/15-theme-00-home-adsorption.md`](../../cod-sdk/theme-sdk/15-theme-00-home-adsorption.md),
  [`16-theme-00-home-adsorption-report.md`](../../cod-sdk/theme-sdk/16-theme-00-home-adsorption-report.md).
- **Phase 6 — page-data foundation (2026-10-01):** the home document is now
  the store's saved `page_documents` row when one exists, with the shipped
  `home.page.json` as the default (absent / invalid / zero type overlap) —
  decided by the pure `src/theme/pages/home-document.ts` and read through
  `store.pageData.get("home")`. The runtime never writes documents (Codflow
  Cloud Studio does, via the control plane). Seed a local one:
  `cd cod-server && npm run db:seed:page-document -- --file=../cod-astro/theme-00/src/theme/pages/home.page.json`.
- **Content packs split per area (DX slice, 2026-10-01):** `src/theme/content/`
  is now one folder per locale (`ar/ en/ fr/`), each one file per area
  (`home.ts`, `order-form.ts`, `cart.ts`, `reviews.ts`, …) — 12 areas over the
  216 keys — plus a per-area type in `content/types/`; `content/types.ts`
  composes the one flat `StoreFrontContent` and each `<lang>/index.ts` assembles
  the pack. **Lossless**: proven by a recorded fingerprint (same 216 keys + same
  values × 3 locales), `astro check` 0/0, 505 tests, `validate:all` 100%.
  `content/__tests__/packs.test.ts` guards cross-locale parity and order.
  Design + report:
  [`cod-sdk/theme-sdk/19-phase-6-reassessment.md`](../../cod-sdk/theme-sdk/19-phase-6-reassessment.md),
  [`20-phase-6-page-data-foundation.md`](../../cod-sdk/theme-sdk/20-phase-6-page-data-foundation.md),
  [`21-phase-6-page-data-foundation-report.md`](../../cod-sdk/theme-sdk/21-phase-6-page-data-foundation-report.md).
- **Design + report:** the SDK, the theme contract and the page-data foundation
  are recorded under [`cod-sdk/theme-sdk/`](../../cod-sdk/theme-sdk/) (slices
  15/16 home adsorption, 19/20/21 page data).

## Deployment

**Do not deploy this package directly.** Its `wrangler.jsonc` still points at
the production storefront's Worker, so a deploy from here collides with the live
store. Shipping this theme to a store goes through the platform's release flow,
not a local `wrangler deploy`.

## Documentation

- **[`THEME_GUIDE.md`](./THEME_GUIDE.md)** — design system, hard rules, component inventory
- **[`THEME_CONSUMER_CHECKLIST.md`](./THEME_CONSUMER_CHECKLIST.md)** — theme creation and verification checklist
- **[`CONTENT_KEYS_REFERENCE.md`](./CONTENT_KEYS_REFERENCE.md)** — all storefront content keys (155) grouped by section
- **[`src/theme/sdk.ts`](./src/theme/sdk.ts)** — the one platform read seam (SDK client factory)
- **[`src/theme/utils/images.ts`](./src/theme/utils/images.ts)** — the image-URL binding (SDK helpers at the store's `config.media`)
- **[`src/theme/README.md`](./src/theme/README.md)** — customizing the theme layer
- **[`wocart-sdk/storefront/USAGE.md`](../../wocart-sdk/storefront/USAGE.md)** — what the SDK promises a theme author
