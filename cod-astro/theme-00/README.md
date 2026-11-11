# Theme-00: the Wocart reference theme

Theme-00 is Wocart's **reference theme**: a complete storefront (Astro 7,
Cloudflare Workers or Vercel, Arabic/French/English) built on the published
SDKs, [`@wocart/storefront`](https://www.npmjs.com/package/@wocart/storefront)
(data) and [`@wocart/theme`](https://www.npmjs.com/package/@wocart/theme)
(composition). It is the worked example for anyone building a theme.

**Read [`THEME_GUIDE.md`](./THEME_GUIDE.md) before changing anything here.** It
is the theme contract: structure, hard rules, composition and design system.
Coding agents also read [`AGENTS.md`](./AGENTS.md).

To start a new theme of your own, use
[`create-wocart-theme`](https://www.npmjs.com/package/create-wocart-theme)
(`npm create wocart-theme@latest my-theme`) and the
[Theme SDK guide](https://docs.wocart.store/sdk/theme).

## How it uses the SDKs

Theme-00 installs the SDKs **from npm**, exactly as an outside theme does:
`package.json` pins `@wocart/storefront` and `@wocart/theme` to exact
versions, and the theme keeps its own `package-lock.json`. It is not an npm
workspace of this repository. Platform behavior lives in the SDKs; the theme
reaches it through `src/theme/sdk.ts` (reads) and `src/theme/utils/images.ts`
(image URLs).

## What it includes

- Home, product listing, category, collection, product, search, contact and
  order tracking pages, plus landing pages (`/lp/…`) and legal pages
- The cash-on-delivery order form: home delivery or stop desk, live shipping
  prices, variants, offers and coupons
- An optional shopping cart and checkout page
- Reviews from verified orders
- Arabic (right-to-left, the default), French and English
- Design tokens and a Home page the merchant can edit in Wocart Cloud

## Quick start

Requires Node 22.12+ and a running API (`cod-server`): the storefront reads
everything from its `/store/*` endpoints. See
[Local setup](https://docs.wocart.store/self-hosting/local) to run one.

```sh
cd cod-astro/theme-00
npm ci                           # its own install, SDKs from npm
cp .dev.vars.example .dev.vars   # fill in your values
npm run dev -- --port 4322       # the dashboard uses :4321
```

## Environment variables

Declared in `astro.config.mjs` (`env.schema`). Locally they come from
`.dev.vars`; in production `STORE_API_KEY` is a `wrangler secret`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `STORE_API_KEY` | yes | The store's key, sent as `X-Store-API-Key` to `/store/*`. Must match the key seeded into D1 (local default: `codflow-dev-store-key`). |
| `COD_SERVER_URL` | yes | The API's base URL (local: `http://localhost:8787`). |
| `WOCART_PREVIEW_KEY` | no | The editor's public key, set by Wocart Cloud's deploy. It opens `/wocart-preview` and lets `/wocart-revalidate` clear cached pages after a publish. Unset, both answer 404. |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Astro dev server |
| `npm run build` | Production build for Cloudflare (`build:vercel` for Vercel) |
| `npm run preview` | Build, then run the Worker locally with `wrangler dev` |
| `npm run deploy` | Build and deploy to Cloudflare Workers, with `COD_SERVER_URL` and `ASTRO_KEY` from the repository's root `.env` |
| `npm run key:create` | Generate the `ASTRO_KEY` for the root `.env` |
| `npm test` | Unit, contract and guard tests (Vitest) |
| `npm run validate:all` | Check for hard-coded strings and design values, then build |
| `npm run cf-typegen` | Regenerate `src/env.d.ts` from `wrangler.jsonc` |

## Project structure

```
src/
├── theme/          # everything theme-owned
│   ├── components/ # Astro components by area
│   ├── content/    # UI text: one folder per language (ar/, en/, fr/)
│   ├── catalog/    # Home section definitions (one *.def.ts per section)
│   ├── pages/      # the default Home page document (home.page.json)
│   ├── layouts/    # StoreLayout.astro
│   ├── scripts/    # browser behavior: product, checkout, cart
│   ├── styles/     # global.css and design tokens
│   ├── theme.ts    # assembles the catalog (defineTheme)
│   └── sdk.ts      # the one place the theme reads platform data
├── actions/        # placeOrder, a thin binding over the SDK
├── middleware.ts   # a thin binding over the SDK middleware
└── pages/          # routes, and /api/* proxies over the SDK
```

## Deployment

Follow [Deploy](https://docs.wocart.store/self-hosting/deploy): it sets the
root `.env` and the store key, then runs `npm run deploy` here. The deploy
refuses an API URL that points at `localhost`.

## Documentation

- [`THEME_GUIDE.md`](./THEME_GUIDE.md): the theme contract, hard rules and design system
- [`CONTENT_KEYS_REFERENCE.md`](./CONTENT_KEYS_REFERENCE.md): every storefront text key, by area
- [`src/theme/README.md`](./src/theme/README.md): customizing the theme layer
- `node_modules/@wocart/storefront/USAGE.md`: what the SDK promises a theme
- [docs.wocart.store](https://docs.wocart.store): the Storefront and Theme SDK guides
