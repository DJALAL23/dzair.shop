# CodFlow Server

The backend engine for CodFlow — a COD-first e-commerce platform for Algeria
that is **agentic-ready**. It exposes the merchant REST API, the public
storefront API, delivery-carrier webhooks, and a complete **MCP remote server**
(RFC 9728) so AI agents can operate the store with RBAC-scoped tools. Built on
Cloudflare Workers, Hono, and Drizzle ORM, with D1, Queues and Cloudflare
Workflows under the hood.

This package is part of the [CodFlow monorepo](../README.md). The dashboard
(`cod-client-astro`) and storefront (`cod-astro`) live in sibling folders and
share database schema + query logic via `cod-shared`.

## Tech Stack

- **Runtime:** Cloudflare Workers (Edge)
- **Framework:** Hono
- **Database:** Cloudflare D1 (SQLite) via Drizzle ORM
- **Validation:** Zod
- **API docs:** [@hono/zod-openapi](https://github.com/honojs/middleware) — the OpenAPI 3.1 spec generates from the route definitions themselves
- **Language:** TypeScript

## Getting Started

### Prerequisites

- Node.js 22.12+ and npm
- A Cloudflare account — Wrangler ships as a devDependency (`npx wrangler …`)

### 1. Install

```bash
npm ci        # at the repo root — installs all workspaces
```

### 2. Configure

All configuration lives in two files. **Nothing is hardcoded** — every URL,
database, and bucket is a placeholder you replace with your own resources.

1. **`wrangler.toml`** — non-secret config (D1 database, R2 bucket, public URLs).
   Create your resources and paste the values in:

   ```bash
   wrangler login
   wrangler d1 create <your-db-name>   # → copy the returned database_id into wrangler.toml, set COD_DB_NAME in the root .env
   wrangler r2 bucket create <your-bucket> # → match bucket_name in wrangler.toml, set COD_R2_BUCKET_NAME in the root .env
   wrangler kv namespace create RATE_LIMIT  # → kv id
   wrangler kv namespace create OAUTH_KV    # → kv id (MCP OAuth provider)
   ```

2. **`.dev.vars`** — local secrets (gitignored):

   ```bash
   cp .dev.vars.example .dev.vars
   ```

### 3. Create the database schema

```bash
# Apply migrations, then set the store up (scripts/seed-store.ts)
npm run db:setup:local
```

`npm run db:seed:local` runs the setup alone. It creates the store
`store-local-dev` and its storefront API key (from `$STORE_API_KEY`, then
`cod-astro/theme-00/.dev.vars`, then a built-in dev default) when they are
missing, and gives the store the menus, collections, legal pages and shipping
profile it lacks — `cod-shared/starter/`, the only source of seed data. Add
`-- --images=<dir>` with the starter pictures (`starter-<name>.webp`) to fill
an empty store with the starter catalog as well.

> **First dashboard login:** the dashboard disables sign-up — create the admin
> with the seeder instead (see `cod-client-astro/README.md`):
> ```bash
> cd ../cod-client-astro && npm run seed:admin
> ```

### 4. Run locally

```bash
npm run dev
# Server → http://localhost:8787
# OpenAPI spec → http://localhost:8787/api/openapi.json
```

Local D1 state is shared with the dashboard through `<repo-root>/.wrangler-shared`,
so dashboard and server read the same SQLite file during development.

### 5. Test

```bash
npm test          # full suite (Vitest)
npm run build:ci  # type-checks + dry-run wrangler bundle
```

### 6. Deploy

```bash
npm run deploy                 # default environment
npm run deploy -- --env production   # after editing [env.production] in wrangler.toml
```

R2 credentials (`CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
must be set as secrets in production, not in `wrangler.toml`:

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

## Environment Variables

### Non-secret (`wrangler.toml` `[vars]`)

| Variable | Purpose | Local default |
|----------|---------|---------------|
| `ENVIRONMENT` | `development` \| `production` | `development` |
| `WORKER_URL` | Public URL of this Worker (used in OpenAPI docs) | `http://localhost:8787` |
| `MEDIA_DOMAIN` | Domain fronting the R2 bucket (public image URLs) | `media.example.com` |
| `R2_BUCKET_NAME` | R2 bucket name | `codflow-images` |
| `BETTER_AUTH_URL` | Dashboard Worker's Better Auth origin — `iss` + JWKS source for the JWTs the dashboard issues | `http://localhost:4321/api/auth` |
| `WORKER_SELF_URL` | This Worker's own origin — required `aud` claim for MCP tokens | `http://localhost:8787/` |

### Secrets (`.dev.vars` locally / `wrangler secret put` in prod)

| Variable | Purpose |
|----------|---------|
| `STORE_API_KEY` | Shared secret the storefront sends as `X-Store-API-Key` (SHA-256 hashed at rest) |
| `BETTER_AUTH_SECRET` | Better Auth signing secret — must match cod-client-astro's |
| `MCP_LOGIN_TICKET_SECRET` | HMAC key for the MCP OAuth login-ticket relay — must match cod-client-astro's |
| `MCP_REQUEST_STATE_KEY` | HMAC key sealing stateless MCP elicitation state |
| `COOKIE_ENCRYPTION_KEY` | Cookie-encryption key for the OAuth consent flow |
| `CF_ACCOUNT_ID` | Cloudflare account id — builds the R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` | R2 API token access key (presigned image uploads) |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |

## Project Structure

```
cod-server/
├── src/
│   ├── index.ts               # Worker entry — routes, MCP server, the events queue, cron
│   ├── types/                 # Env bindings (mirrors wrangler.toml), app context types
│   ├── db/                    # D1 + Drizzle helpers (schema re-export, migrate, migrations/)
│   ├── middleware/            # better-auth session/bearer auth, store API key, CORS, error handling
│   ├── endpoints/             # One folder per domain (see route list below)
│   ├── lib/                   # Meta CAPI client, activity log, shared errors
│   ├── mcp/                   # MCP remote server (OAuth provider wiring + scope-gated tool registry)
│   ├── events/                # Business Events: the catalogue's schemas, the drain, Consumer Kinds (Meta conversions)
│   ├── workflows/             # Durable Cloudflare Workflows (landing-page images, review media)
│   ├── cron/                  # Scheduled handlers (abandoned-order sweep)
│   ├── openapi/               # OpenAPI assembly: security schemes, Swagger UI, shared Zod schemas — the served spec generates from route definitions
│   ├── rbac/                  # Scope-based authorization middleware
│   └── test-utils/            # Shared test helpers
├── scripts/                   # dev utilities (seed, R2 CORS, migration validation)
├── wrangler.toml              # Worker config — all values are placeholders
├── drizzle.config.ts
└── vitest.config.ts
```

## API Overview

REST API is mounted under `/api/*`. It is fully documented by an OpenAPI 3.1
spec that is **generated from the route definitions** (`@hono/zod-openapi`):

- Machine-readable spec: `/api/openapi.json`
- Interactive Swagger UI: `/api/docs`

Public routes: `/`, `/health`, `/images`, `/api` (OpenAPI spec + docs),
`/webhooks/*` (delivery-carrier callbacks, signature-verified), `/store/*`
(storefront read + order placement, `X-Store-API-Key`), `/.well-known/*`, and
`/mcp` (MCP protocol). All other `/api/*` routes require a session or bearer token.

- `/api/orders` — orders, status lifecycle, driver assignment, stats
- `/api/customers`, `/api/customer-groups`, `/api/customer-tags`
- `/api/drivers`, `/api/driver-payments`
- `/api/products`, `/api/product-groups`, `/api/products/:id/variants` (variants are nested, not a top-level route), `/api/stock`, `/api/offers`, `/api/reviews`
- `/api/wilayas`, `/api/shipping-profiles`
- `/api/delivery-companies` — carrier adapters (Yalidine, ZR Express, NOEST, EcoTrack) + webhook handlers
- `/api/stores` — `me` (the public storefront API lives at `/store/*`)
- `/api/apps` — the store's Apps and their App Status; each App under `/api/apps/<key>` (Meta, DZVerify, Turnstile, Sendili, WhatsApp button), with its own permissions
- `/api/event-consumers`, `/api/event-deliveries` — webhooks (Integrations) and the Apps' Built-in Consumers, each seen with its owner's permission
- `/api/users` — staff/admin + API keys
- `/api/analytics`, `/api/activity-logs`, `/api/abandoned-orders`
- `/api/images` — R2 presigned upload
- `/api/mcp` — MCP agent connection management (`/me`, `/team`; the `/mcp` endpoint itself serves the MCP protocol)

## Notable Subsystems

### MCP remote server
`src/mcp/` implements an MCP (Model Context Protocol) server so AI agents can
manage the store, fronted by `@cloudflare/workers-oauth-provider` (discovery,
dynamic client registration, tokens, revocation; state in `OAUTH_KV`). The
dashboard's sign-in sessions mint the access tokens via the login-ticket relay
(`/authorize`), and dangerous tools require HMAC-sealed stateless
confirmation. The tool factories are gated by RBAC scopes.

### Meta conversions
Meta conversions are a Consumer of Business Events (`src/events/consumers/meta-capi.ts`):
the store's built-in Consumer receives `order.created` (a shopper's checkout),
`order.confirmed` (from any surface), `shipment.delivered`, and
`shipment.out_for_delivery` for long-haul southern wilayas (5–10 day delivery).
The merchant's tracking settings decide what is sent; `event_time` is when it
happened. Delivered by the drain, never by the change itself — an analytics
failure can never affect order state. Nothing is sent for a store without an
enabled `storePixelConfig` with an `accessToken`.

### Abandoned orders
An hourly cron sweeps pending orders older than 30 minutes to `abandoned`.

## Contributing

- One endpoint = one folder in `src/endpoints/`, following the
  `routes.ts` / `handlers.ts` / `validation.ts` split.
- Define routes with `defineRoute()` from `src/lib/route-builder` on an
  `OpenAPIHono` router: the route definition is the single source of truth
  for both request validation and the OpenAPI spec — there are no
  hand-written spec files to keep in sync. Every domain is already on this
  pattern; see `src/endpoints/README.md` for the current state and
  `.agents/skills/route-builder/NEW-ENDPOINTS.md` for the how-to. Reuse
  shared response schemas from `src/openapi/schemas.ts`.
- Shared schema and read queries live in `cod-shared` — do not duplicate them
  in `cod-server/src/db`.
- Keep `wrangler.toml` free of real credentials; if you add an env var, declare
  it in `src/types/env.ts`, `wrangler.toml`, and this README.
- Run `npm test` and `npm run build:ci` before opening a PR.

## License

Open source. See the [repository root](../README.md) for the license.