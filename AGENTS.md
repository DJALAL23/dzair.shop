# Wocart — repository instructions for coding agents

Wocart (formerly CodFlow) is a cash-on-delivery e-commerce platform for
Algeria: TypeScript, deployed on Cloudflare (Workers, D1, R2, KV). Package,
folder, environment-variable and domain names still say CodFlow where
renaming would break existing stores; keep them.

## Layout

- `cod-server/` — the API (Hono on Workers, D1 through Drizzle): merchant
  `/api/*`, public `/store/*`, `/webhooks`, `/media`, `/mcp`.
- `cod-client-astro/` — the merchant dashboard (Astro 7): prerendered pages,
  plus a Worker for `/api/auth/*` and the MCP OAuth login. React islands call
  cod-server only through `src/lib/api.ts`.
- `cod-shared/` — the D1 schema, queries, permission scopes and error codes,
  imported by relative path (`../../cod-shared/...`). Not published.
- `cod-astro/theme-00/` — the reference storefront theme. It installs
  `@wocart/storefront` and `@wocart/theme` from npm like any outside theme and
  has its own lockfile. Read `cod-astro/theme-00/AGENTS.md` before editing it.
- `cod-docs/` — the developer site (Zudoku), in English, French and Arabic, with
  its own lockfile. Read `cod-docs/README.md` before editing it.

The root `package.json` has three npm workspaces (`cod-shared`, `cod-server`,
`cod-client-astro`) and the one root `package-lock.json`. Theme-00 and
`cod-docs` are deliberately outside them. Never add a lockfile to a workspace.

## Commands

```sh
npm ci                              # repo root: every workspace
cd cod-server && npm run typecheck && npm test
cd cod-server && npm run dev        # wrangler dev on :8787
cd cod-client-astro && npm run typecheck && npm test
cd cod-client-astro && npm run dev  # astro dev on :4321

cd cod-astro/theme-00 && npm ci && npm test && npx astro check
cd cod-docs && npm ci && npm run typecheck && npm run check:i18n
```

First local run: `cd cod-server && npm run db:setup:local`, then
`cd cod-client-astro && npm run seed:admin` (sign-up is disabled by design).
Signing in against an unmigrated local D1 is the usual cause of a dashboard
that "doesn't work" locally.

The dashboard and a storefront both default to port 4321; run one with
`--port 4322` when developing both.

A docs build fetches `/api/openapi.json` from a local cod-server, or from
`COD_OPENAPI_URL` when set.

## Verification

- After changing TypeScript, run `npm run typecheck` in the affected package.
- After changing behavior, run `npm test` in the affected package.
- CI (`.github/workflows/ci.yml`) runs typecheck and tests for cod-server and
  the dashboard, and Theme-00's tests, `astro check` and build against the
  published SDKs.

## Conventions

- **Claims are verified against the code.** Never write a feature into the
  README or the docs that the code does not do.
- **Never commit secrets.** No live keys, carrier tokens or credentials in
  source, tests or fixtures. Secrets go in `wrangler secret` or `.dev.vars`
  (gitignored). The real `wrangler.toml` files are gitignored; commit only the
  `.example` templates.
- No explanatory code comments unless asked.
- **Private folders are never committed.** `docs/`, `wocart-sdk/` and
  `.agents/internal-skills/` are maintainers' local folders, gitignored; never
  force-add them and never link to them from tracked files. Anything
  developers or users need goes in `cod-docs`.

## Boundaries

- `cod-shared` is the single source of truth for the schema, queries, scopes
  and error codes. Never duplicate them in an app.
- **A migration never loses a store's data.** Add a new migration; never
  rewrite a released one. Migrations run on live stores before the new server
  is deployed, so each keeps every row and keeps the running server working:
  add first, stop reading in the next release, drop in a later one. A
  statement that deletes or rewrites rows declares it with
  `-- data-safety: <table>[.<column>] — <reason>` (or
  `-- data-safety: rebuild <table> — <reason>`), and the migration gets its
  own `src/db/migration-<NNNN>-*.e2e.test.ts` proving it on data. Never
  rebuild (DROP + RENAME) a table other tables reference: on D1 the drop
  deletes their rows through `ON DELETE CASCADE`, whatever the pragmas.
  `cod-server/src/db/migration-safety.e2e.test.ts` enforces this.
- Ask before adding a production dependency or changing the D1 schema.
- Theme-00 holds no engine logic: platform rules belong in
  `@wocart/storefront`. It imports the SDKs only through their published
  entry points (`sdk-boundary-contracts.test.ts`), and no validator reaches
  shoppers' pages (`no-validator-in-browser.test.ts`).
- The dashboard reads data only through `src/lib/api.ts`; components never call
  `fetch`, and the dashboard never queries D1 for business data.
- Theme editing (text edits, page documents, theme settings) is written by
  Wocart Cloud's editor, which is closed source. This repository only reads
  them; never add theme-writing endpoints or UI here.

## Domain rules

- **Delivery belongs to the shipment.** An order's status is its processing
  only (`cod-shared/orders/lifecycle.ts`); carrier, driver, tracking and
  delivery milestones live in `shipments` and `shipment_events`, driver
  settlement in `driver_payment_lines`. `orders.driver_id`,
  `orders.company_id` and `webhook_events.order_id` still exist in D1 but not
  in the Drizzle schema; never read or write them.
- **Business events are written with the change.** A `cod-shared` writer of
  orders or shipments records its event with `recordEvent` in the same batch.
  Never dispatch a side effect from a handler. A deployed cod-server needs the
  `EVENTS_QUEUE` producer and consumer, and both crons
  (`"0 * * * *"`, `"*/5 * * * *"`), as `wrangler.toml.example` declares.
- **Carriers.** Only Yalidine and ZR Express send webhooks; they land in the
  `webhook_events` inbox and are processed after the answer
  (`cod-server/src/inbound`). NOEST, EcoTrack-platform companies and Guepex
  are synced by the five-minute cron and on demand. Tell carriers apart by
  `provider` and `capabilities`, never by company code.
- **The dashboard never re-implements delivery rules.** It reads the lifecycle,
  the stages and each shipment action's permission from cod-shared
  (`shipments/actions.ts`), and offers only the actions a shipment's `actions`
  list opens.
- **Removal is real deletion.** A deleted product goes for good; order lines
  keep what was sold. An order with a shipment can never be deleted (a trigger
  raises `ORDER_HAS_SHIPMENT`); a finished one is archived. There is no soft
  delete. A script that wipes orders deletes `shipments` first.
- **Orders and the basket.** An order is a basket (`items[]`) or a single
  product; `normalizeOrderLines` (`cod-shared/queries/cart.ts`) is the one
  place the shapes meet. The basket lives in the shopper's browser, never in
  D1, and every line is re-priced server-side: never trust a total from the
  wire. The cart is off by default per store (`stores.cart_enabled`).
- **Languages and translations.** `stores.lang` is the primary language;
  `store_locales` lists the others, and only published ones reach
  `/store/config`. The supported list lives once, in
  `cod-shared/i18n/locales.ts`. Merchant data is translated in the
  `translations` table; the resource's own columns hold the primary language.
  A new translatable resource needs its own delete trigger. Order lines always
  take the catalog's primary-language names.
- **Theme text edits are keyed by theme** (`store_content_overrides`,
  `defineTheme({ key })`); renaming a theme's key orphans its merchants' edits.
- **Reviews.** A shopper proves a purchase with the order number and its
  phone, for a delivered order, one review per product. Photos are kept only
  as WebP from the Images binding, which drops EXIF and GPS. Review files are
  deleted after their rows (`cod-server/src/lib/reviews/removal.ts`). `processing` reviews
  belong to the system.
- **Seed data has one source, `cod-shared/starter/`.** `storeDefaultsSql`
  gives a store its default menus, collections, legal pages and, if it has
  never taken an order, a shipping profile; `demoCatalogSql` adds the starter
  catalog only to a store with no catalog of its own. Both are idempotent;
  `cod-server/scripts/seed-store.ts` (`npm run db:setup:local` / `:remote`)
  runs them. Never add seed data anywhere else.

## Known traps

- **Dashboard i18n.** UI strings come from `locales/{ar,en,fr}` through
  `useT(namespace)`, and the i18n guard test enforces parity. Placeholders and
  counts go through `t(key, values)`: a count is a plural message with one key
  per CLDR form its language has (Arabic has six); never `.replace("{n}")`.
  Relative times use `@/lib/relative-time`.
- **`PUBLIC_API_URL` is baked in at build time.** It does not go in
  `cod-client-astro/.env`, which the build ignores
  (`.dev.vars` > `wrangler.toml [vars]` > `process.env` > `.env`). Set it in
  `.dev.vars` locally and in `wrangler.toml [vars]` for production;
  `npm run deploy` refuses a bundle that contains a loopback URL.
- `BETTER_AUTH_SECRET` and `MCP_LOGIN_TICKET_SECRET` must be identical on
  cod-server and the dashboard.
- The dashboard ships its own KV `secondaryStorage`
  (`src/lib/auth/server.ts`) because `better-auth-cloudflare` 0.3.1 lacks the
  `increment` its rate limiter needs; do not switch back to its `kv:`
  shortcut.
- The OAuth provider tables predate Better Auth 1.7 and lack some of its
  columns and tables; MCP client token flows may need that alignment before
  heavy use.
- **Cloud configuration** comes from the root `.env` through
  `cod-server/scripts/cloud-env.mjs` (`process.env` > `.env` > default). A new
  key goes in its `DEFAULTS` and in `.env.example` together.
  `COD_SERVER_URL` defaults to `http://localhost:8787`; Theme-00's deploy
  refuses a loopback value unless `--force-local` is passed.
- Local D1 state is shared through `.wrangler-shared/`: cod-server writes it,
  and the dashboard's dev server reads it.
- **Vite pins.** The root `overrides` pin Vite (`^8.2.2`) so astro and vitest
  share one major; removing it brings back the `Missing field 'moduleType'`
  crash. Theme-00 carries its own copy, plus `@cloudflare/vite-plugin` 1.53.1
  (newer ones break vitest there), and uses TypeScript 6 because
  `@astrojs/check` 0.9 accepts no newer.
- cod-server's unit-test mock db maps a full-table `select()` by schema column
  order: a new column breaks that table's fixtures until it is added at the
  same position. Its tests need no network or credentials.

## Skills

Two agent skills ship in `.agents/skills/`: `wocart-setup` (set up a
self-hosted store on Cloudflare, with an optional Vercel storefront) and
`wocart-update` (update one to the latest code). Nothing else belongs there.

## Endpoints

Every endpoint is declared with `defineRoute()`:

```typescript
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.PRODUCTS_READ },
  handler: handlers.list,
});

router.openapi(listRoute.route, listRoute.handler);
```

Always take scopes from `SCOPES`, and reuse the shared response schemas in
`cod-server/src/openapi/schemas.ts`.
