# CodFlow — repository instructions for coding agents

CodFlow is a cash-on-delivery (COD) e-commerce platform for Algeria. Monorepo,
TypeScript, deployed on Cloudflare (Workers, D1, R2, KV).

## Layout

- `cod-server/` — Cloudflare Workers API (Hono). Merchant `/api/*`, public
  `/store/*`, `/webhooks`, `/images`, `/mcp`. D1 via Drizzle.
- `cod-client-astro/` — the merchant dashboard (Astro 7). Prerendered static
  pages + a Worker surface for `/api/auth/*` and `/mcp/oauth/login`; React
  islands fetch data from cod-server through `src/lib/api.ts` (the only module
  allowed to call the API). UI strings come from `locales/{ar,en,fr}` via
  `useT(namespace)` — the i18n guard test enforces three-locale parity.
  Placeholders and counts go through `t(key, values)`: a count is a plural
  message, one key per CLDR form (`total_one`, `total_few`, …), each language
  carrying exactly its grammar's forms (Arabic six); never `.replace("{n}")`.
  Relative times use `@/lib/relative-time` (`Intl.RelativeTimeFormat`).
- `cod-shared/` — shared Drizzle schema, queries, RBAC scopes, error codes.
  Imported by the apps via relative path (`../../cod-shared/...`). **Not
  published.**
- `wocart-sdk/` — the published SDKs: `@wocart/storefront` (`storefront/`)
  and `@wocart/theme` (`theme/`), on npm under the `@wocart` org.
  Maintainer guide and release procedure: `wocart-sdk/README.md`.
- `cod-astro/theme-00/` — the storefront theme, the reference for new
  themes, and the SDKs' reference consumer. A swappable theme layer: engine
  logic belongs in `@wocart/storefront`, never here. **Not a workspace**: it
  installs `@wocart/*` from the npm registry, exactly like an outside theme,
  and has its own lockfile. Its commands and boundaries differ — read
  `cod-astro/theme-00/AGENTS.md` before editing it.

There is **one root `package.json` with npm workspaces** and ONE root
`package-lock.json` for every workspace. The one exception is Theme-00, which
is deliberately outside the workspaces with its own `package-lock.json` (see
above); never add a lockfile to a workspace member. The root also carries the
repo-wide npm `overrides`: the single-Vite pin (keeps one Vite major across
astro/vitest; npm ignores `overrides` inside workspace members). Theme-00
carries its own copy of that pin.

## Commands

One install at the repo root covers every package:

```sh
npm ci                          # at repo root — installs all workspaces
(cd cod-astro/theme-00 && npm ci)  # Theme-00 is standalone

cd cod-server && npm run typecheck
cd cod-server && npm test
cd cod-server && npm run dev   # wrangler dev :8787
```

Same for `cod-client-astro` (`npm run typecheck`, `npm test`, `npm run dev`
— astro dev on :4321). Admin bootstrap: `cd cod-client-astro &&
npm run seed:admin` (sign-up is disabled by design).

The SDKs (`wocart-sdk/storefront`, `wocart-sdk/theme`) and Theme-00 as their
reference consumer are checked together by `npm run verify:sdks` at the repo
root: both packages are packed, checked and installed into a clean consumer,
then Theme-00 runs its tests, `astro check` and build against those exact
tarballs before its locked install is restored. Theme-00 may import the SDKs
only through their published entry points; `sdk-boundary-contracts.test.ts`
enforces it. An SDK change reaches Theme-00 only through a release: publish,
then bump the exact pins in Theme-00 and in the editor (CodFlow Cloud's
Studio), which must run the same versions — a theme release and an editor
deploy refuse a drift. Releasing: `wocart-sdk/README.md`.

Browser code never imports a schema: validation runs on the server, where data
enters, and the browser reads what it checked by type or with the SDK's
readers. The SDK's `browser-bundle.test.ts` and Theme-00's
`no-validator-in-browser.test.ts` keep Zod out of shoppers' pages.

Theme-00 has extra validators (`npm run validate:all`) — see
`cod-astro/theme-00/AGENTS.md` for its commands and definition of done.

## Cloud resource configuration

Resource names and URLs are **not** hardcoded in scripts. The seeders, the
D1 migration wrapper (`cod-server/scripts/d1.mjs`), the R2 CORS setup and
the storefront deploy helper all read `<repo-root>/.env` through
`cod-server/scripts/cloud-env.mjs`. Precedence is
**`process.env` > `.env` > built-in default**; the committed template is
`<repo-root>/.env.example`.

Keys: `COD_ACCOUNT_ID`, `COD_DB_NAME`, `COD_R2_BUCKET_NAME`,
`COD_SERVER_URL`, `COD_MEDIA_DOMAIN`. Add a key to `DEFAULTS` in
`cloud-env.mjs` and to `.env.example` together — a key in one and not the
other is how these drift.

## Verification

- After changing TypeScript: run `npm run typecheck` in the affected package.
- After changing behavior: run `npm test` in the affected package.
- Full CI runs typecheck + tests for cod-server and cod-client-astro, and
  `npm run verify:sdks`, which runs Theme-00's tests, `astro check` and build
  against the packed SDKs (`.github/workflows/ci.yml`).

## Conventions

- **README claims must be code-verified.** Never write a feature claim in the
  README that is not actually implemented. Before editing README feature lists,
  confirm the code exists.
- **Never commit secrets.** No live API keys, carrier tokens, or credentials in
  source, tests, or fixtures. Real secrets go in `wrangler secrets` /
  `.dev.vars` (gitignored). Wrangler configs with real resource IDs are
  gitignored too (`wrangler.toml` in cod-server/cod-client-astro) — commit
  `.example` templates only.
- No explanatory code comments unless asked.

## Boundaries

- `cod-shared` is the single source of truth for the D1 schema, queries, RBAC
  scopes, and error codes. Do not duplicate schema or scope definitions in
  cod-server or cod-client-astro.
- **A migration never loses a store's data.** Add a new migration; never
  rewrite a released one. A migration runs on every live store — Cloud and
  self-hosted — before the new server is deployed, so it keeps every row and
  value, and keeps the running server working: add first, stop reading in
  that release, drop in a later one. A statement that deletes or rewrites
  rows names its table in `-- data-safety: <table>[.<column>] — <reason>` (or
  `-- data-safety: rebuild <table> — <reason>`), and the file gets its own
  `src/db/migration-<NNNN>-*.e2e.test.ts` proving it on data. Never rebuild
  (DROP + RENAME) a table other tables reference: on D1 the drop deletes
  their rows through `ON DELETE CASCADE` even with
  `PRAGMA defer_foreign_keys`, and `PRAGMA foreign_keys` does nothing there.
  `cod-server/src/db/migration-safety.e2e.test.ts` enforces this on a
  database with a row in every table; the platform release runs it even with
  `--skip-checks`.
- Ask before adding a production dependency or changing the D1 schema.
- Keep engine logic out of `cod-astro/theme-00`; the theme layer is meant to be
  swappable (see `cod-astro/theme-00/AGENTS.md`).
- Dashboard data access goes through the API seam (`cod-client-astro/src/lib/api.ts`).
  Components never call `fetch` directly, and the dashboard does not query D1
  for business data — authorization lives in cod-server.

## Known traps

- Never create per-package `package-lock.json` files in a workspace (see
  Layout). If a workspace's deps look stale, run `npm ci` at the repo root.
  Theme-00's own lockfile is the deliberate exception.
- Theme-00 pins `@cloudflare/vite-plugin` to 1.53.1 in its `overrides`.
  1.63.x makes vitest fail at startup ("There is already a server associated
  with the config") when the Cloudflare adapter loads through
  `getViteConfig`. Lift the pin once a newer plugin passes `npm test` there.
- Theme-00 uses TypeScript 6, not 7: `@astrojs/check` 0.9 accepts only
  TypeScript 5–6 as its peer. The workspaces use TypeScript 7.
- The Vite pin lives in the **root** `package.json`
  (`"overrides": { "vite": "^8.2.2" }`) — npm ignores `overrides` inside
  workspace members. It keeps a single Vite major across astro/vitest;
  removing it reintroduces the dual-Vite boot crash
  (`Missing field 'moduleType'`). Keep it in sync when astro bumps Vite.
- `COD_SERVER_URL` defaults to `http://localhost:8787` so local dev works
  untouched. A deployed Worker can never reach that, so
  `cod-astro/theme-00/scripts/deploy.mjs` refuses to deploy a loopback value
  unless `--force-local` is passed. Set the real origin in the root `.env`
  before deploying the storefront.
- Local D1 state is **shared** through `<repo-root>/.wrangler-shared`:
  cod-server's dev/migrate scripts write there via `--persist-to`, and
  cod-client-astro's astro dev reads the same files via the Cloudflare
  adapter's `persistState`. Sign-in against an unmigrated local D1 is the
  #1 "dashboard broken locally" cause — run `cod-server npm run db:setup:local`
  first, then `cod-client-astro npm run seed:admin`.
- `PUBLIC_API_URL` is a **build-time** client value: `astro:env/client` inlines
  it into the browser bundle, so changing it requires a rebuild. It does **not**
  go in `cod-client-astro/.env` — the Cloudflare adapter pushes wrangler values
  and `.dev.vars` into `process.env`, and Astro reads env with an empty prefix,
  so Vite's final `process.env` pass outranks the .env files:
  `.dev.vars` > `wrangler.toml [vars]` > `process.env` > `.env`. A value in
  `.env` is silently ignored, and `.dev.vars` — local-only by Cloudflare's
  definition but still read during a build — once baked `http://localhost:8787`
  into production. Set it in `.dev.vars` (local) and `wrangler.toml [vars]`
  (production); `cod-client-astro npm run deploy` parks `.dev.vars` for the
  build and refuses to upload a bundle containing a loopback URL. Runtime vars
  (`PUBLIC_APP_URL`, `PUBLIC_TRUSTED_ORIGINS`) live in wrangler.toml `[vars]`.
- `BETTER_AUTH_SECRET` and `MCP_LOGIN_TICKET_SECRET` must be **identical** on
  cod-server and cod-client-astro (shared auth D1 + MCP login-ticket relay).
- Better Auth 1.7 schema requirements live in migrations 0010/0011:
  `accounts.issuer` ('local:credential', account_id = user id) and
  `jwkss.alg/crv`. cod-client-astro ships its own KV `secondaryStorage` in
  `src/lib/auth/server.ts` because better-auth-cloudflare@0.3.1 lacks the
  `increment` method its rate limiter requires — do not swap back to `kv:`
  shortcut.
- OAuth provider tables predate better-auth 1.7: `oauthClients`,
  `oauthAccessTokens`, `oauthRefreshTokens`, `oauthConsents` are missing some
  1.7 columns, and `oauthResource(s)`, `oauthClientResource(s)`,
  `oauthClientAssertion(s)` do not exist yet. Core auth + dashboard work;
  MCP client token flows may need that alignment before heavy use.
- The dashboard Worker and the storefront both default to port **4321** — run
  one on `--port 4322` when developing both at once.
- Inbound webhooks exist only for **Yalidine** and **ZR Express**; they are
  stored in the `webhook_events` inbox, answered at once and processed after
  (`cod-server/src/inbound`). NOEST, EcoTrack-platform companies and Guepex
  send none: their shipments are synced every five minutes by the
  `*/5 * * * *` cron (`src/inbound/cron.ts`) and on demand with
  `POST /shipments/{id}/sync` or `POST /delivery-companies/{id}/sync-shipments`.
  The deployed `wrangler.toml` must list that cron beside the hourly one.
- **Delivery is the shipment's** (ADR 0006): an order's status is its
  processing only (`cod-shared/orders/lifecycle.ts`); carrier, driver,
  tracking and the delivery's milestones live in `shipments` and
  `shipment_events`, driver settlement in `driver_payment_lines`.
  `orders.driver_id`, `orders.company_id` and `webhook_events.order_id`
  still exist in D1 but not in the Drizzle schema: SQLite cannot drop a
  column a table `FOREIGN KEY` clause names, so migration 0041 emptied them.
  Never read or write them.
- **Removal is real deletion, kept consistent by the database** (migration
  0042): a product goes for good and order lines keep what was sold (their
  `product_id` becomes null); an order with a shipment can never be deleted —
  a trigger raises `ORDER_HAS_SHIPMENT` even in raw SQL — and a finished one is
  archived (`orders.archived_at`). There is no soft delete. A script that wipes
  orders must delete `shipments` first.
- **Reviews** (migration 0043, `cod-shared/reviews/`): a shopper proves a
  purchase with the order number **and** its phone, for a delivered order,
  one review per product of it. Photos and a voice note are uploaded first,
  then prepared by `CodReviewMediaWorkflow` after the answer (photos only ever
  kept as WebP from the Images binding — that is what drops EXIF/GPS). Review
  files are deleted after their rows (`lib/reviews/removal.ts`), never by a
  DB cascade alone. `processing` reviews belong to the system.
- **The dashboard never re-implements delivery rules.** It reads them from
  cod-shared — the lifecycle, the stages, the permission each shipment
  action takes (`shipments/actions.ts`), the reports a kind allows — and
  offers only the actions a shipment's `actions` list opens. A carrier is
  told apart by its `provider` and `capabilities`, never by its company code
  (`endsWith("_ecotrack")` and the like are the old way).
- **Store languages are rows, not a column** (ADR 0005): `stores.lang` is
  the primary, `store_locales` lists every added language with a `published`
  flag, and only published ones reach `/store/config`. The supported list
  lives once, in `cod-shared/i18n/locales.ts` — the SDKs never mirror it; the
  server sends each language's code, name and direction.
- **Merchant data is translated in one `translations` table** (resource,
  language, key — `cod-shared/i18n/translations.ts`). The resource's own
  columns hold the primary language; there is never a translation row for it.
  It has no foreign keys: migration 0037's triggers delete a resource's rows
  with it. A new translatable resource needs its own trigger. Variant options
  are translated on their product, keyed by source text (`option:[…]`); a
  language renames `variantOptions` and `variations` together
  (`translateOptions`), and order lines and abandoned checkouts always take
  the catalog's primary-language names, never the storefront's text.
- **Theme text edits are keyed by theme** (`store_content_overrides`,
  `defineTheme({ key })`), and a storefront only receives them when its SDK
  client passes `theme`. Renaming a theme's key orphans its merchant edits.
  This repo only reads them: theme editing (text edits, page documents) is
  written by CodFlow Cloud's visual editor, which is closed source and lives
  outside this repository — never add theme-writing endpoints or UI here.
- The **shopping cart is off by default, per store** (`stores.cart_enabled`).
  A store that never enables it ships no cart markup at all. Rollback for the
  whole feature is `UPDATE stores SET cart_enabled = 0` — there is no data
  migration to reverse, because a multi-line order is a valid CodFlow order the
  dashboard and carriers already understand.
- **An order is either a basket or a single product.** `items[]` supersedes the
  flat `productId`/`productName`/`pricePerUnit`, which are optional only when
  `items[]` is present. `cod-shared/queries/cart.ts` (`normalizeOrderLines`) is
  the single place the shapes meet — do not branch on them anywhere else.
- **The basket lives in the shopper's browser, never in D1.** The client's
  `pricePerUnit` is display-only; every line is re-priced from the catalog
  server-side. Never trust a cart total that arrived over the wire.
- The mock db in cod-server's unit tests maps a full-table `select()`
  **positionally by schema column order**. Adding a column to a table breaks
  every fixture for it until the new field is inserted at the same position —
  this is why those fixtures list columns in schema order with a comment.
- cod-server tests run on miniflare + better-sqlite3 locally with no network
  or credentials required.
- **Seed data has one source: `cod-shared/starter/`.** `storeDefaultsSql`
  gives a store what it lacks of the header and footer menus, the three
  default collections, the four legal pages and — only for a store that has
  never taken an order, since a store without a shipping profile delivers
  free — a default shipping profile. `demoCatalogSql` adds the starter
  catalog (six products, categories, variants, collections, offers, coupons,
  menu links, in ar/fr/en; ids under `<storeId>:starter:`) only to a store
  with no products or categories of its own. Both are idempotent. The one
  script is `cod-server/scripts/seed-store.ts` (`npm run db:setup:local` /
  `db:setup:remote`): it creates the store row and API key when missing, the
  defaults always, the catalog with `--images=<dir>` (its pictures,
  `starter-<name>.webp`, go to the store's R2 first). CodFlow Cloud runs the
  same SQL from each platform release (`starterTemplates`). Never add seed
  data anywhere else. The dashboard's Pages screen → "Add Terms, Privacy,
  Refund & Shipping" (`POST /api/store-pages/seed-defaults`) writes the same
  legal pages; without them Meta Ads rejects the store's ads
  (`report-md/LEGAL_PAGES_PLAN.md`).

## Skills

This project has custom skills for AI agents. When working on specific tasks, activate the relevant skill:

### Route Builder (API Endpoints)

For creating or migrating API endpoints, use the **route-builder** skill:

```bash
# Activate the skill (if using Kiro with skills)
disclose_context: route-builder
```

This skill provides:
- **SKILL.md** - Quick reference for the defineRoute() pattern
- **MIGRATION.md** - Step-by-step guide for migrating existing endpoints
- **NEW-ENDPOINTS.md** - Guide for creating new endpoints
- **EXAMPLES.md** - Real-world examples from the codebase

### Key Patterns

**Always use defineRoute() for new endpoints:**
```typescript
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";

const myRoute = defineRoute({
  method: "get",
  path: "/my-resource",
  auth: { scope: SCOPES.RESOURCE_READ },  // Always use SCOPES constants
  handler: handlers.list,
});

router.openapi(myRoute.route, myRoute.handler);
```

**Migration workflow:**
1. Create `routes.prototype.ts` 
2. Convert routes using defineRoute()
3. Run tests: `npm test -- <endpoint>`
4. Verify no behavior changes

### Available Skills

| Skill | When to Use |
|-------|-------------|
| `route-builder` | Creating or migrating API endpoints |
| `code-review` | Reviewing code changes |
| `codebase-design` | Understanding architecture |
| `prototype` | Building throwaway prototypes |
| `improve-codebase-architecture` | Refactoring or architecture changes |
| `tdd` | Test-driven development |
| `wayfinder` | Navigating the codebase |
| `codflow-setup` | Setting up the project (Cloudflare + Vercel) |
| `storefront-vercel` | Deploying or configuring the customer storefront on Vercel |
| `whatsapp-otp` | WhatsApp OTP verification feature (dzverify) |
| `Ecotrack` | EcoTrack carrier integration |
| `zr-express` | ZR Express delivery platform integration (129 endpoints, organized per domain) |
| **`diagnosing-bugs`** | **Debug production issues (orders, delivery, payments)** |
| **`domain-modeling`** | **Design data models for complex domain** |
| **`implement`** | **Turn specs into working code** |
| **`to-spec`** | **Convert ideas into formal specifications** |
| **`to-tickets`** | **Break features into GitHub issues** |

For more details on any skill, see the `.agents/skills/` directory.
