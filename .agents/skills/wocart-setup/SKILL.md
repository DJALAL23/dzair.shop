---
name: wocart-setup
description: >-
  Setup runbook for a self-hosted Wocart store (formerly CodFlow). An AI agent
  following it creates the store's Cloudflare resources in the developer's
  account, fills the gitignored configuration with their real IDs, sets the
  secrets, migrates and seeds the database, deploys the API server and the
  dashboard to Cloudflare Workers and the storefront to Cloudflare or Vercel,
  puts them on the developer's domains, and verifies the result. Use when a
  developer wants to set up or deploy Wocart (or CodFlow) for the first time.
  For an install that already exists, use the wocart-update skill instead.
---

# Wocart setup — agent runbook

Wocart (formerly CodFlow) is a cash-on-delivery commerce platform for Algeria.
One store is three Cloudflare Workers sharing one D1 database:

| Part | Folder | Runs on |
| --- | --- | --- |
| API server | `cod-server/` | Cloudflare Workers |
| Merchant dashboard | `cod-client-astro/` | Cloudflare Workers |
| Storefront (Theme-00) | `cod-astro/theme-00/` | Cloudflare Workers or Vercel |

Folder names, package names, environment variables (`COD_*`) and some
template defaults still say CodFlow. That is expected; never rename them.

This runbook takes a fresh clone to a working, verified store. Follow it in
order and do not skip a check. The step-by-step guides in the checkout say the
same in more detail: `cod-docs/pages/self-hosting/` (`local.mdx`,
`configuration.mdx`, `deploy.mdx`, `media.mdx`).

## Rules for the agent

- **Tell the developer what you do, step by step,** in plain language. They
  may not be a developer. Ask before anything they must decide (names,
  domains, Vercel or Cloudflare, ImageKit or R2) and never guess a value only
  they have.
- **Create new resources for this store.** Never bind a D1 database, bucket,
  KV namespace or queue that already exists in the account: it may belong to
  another store, and migrating or seeding it would write into its data.
- **No placeholder may survive.** Every ID and URL comes from a command's
  output or from the developer.
- **Secrets never touch the shell history or a tracked file.** Pass them on
  standard input from a `chmod 600` file outside the repository, and delete
  the file afterwards.
- **Wrangler account.** If the shell exports a `CLOUDFLARE_ACCOUNT_ID` the
  login cannot access, every Wrangler command fails with
  `Authentication error [code: 10000]`. Run `unset CLOUDFLARE_ACCOUNT_ID` once
  per session, or prefix commands with `env -u CLOUDFLARE_ACCOUNT_ID`.

## Before starting — state this to the developer

> "I will create a D1 database, an R2 bucket, three KV namespaces and a queue
> in your Cloudflare account, fill your configuration files with their IDs,
> migrate and seed the database, and deploy the API server, the dashboard and
> the storefront. The API and the storefront need your own domain on
> Cloudflare. Nothing is left on example values."

## Prerequisites

- Node.js 22.12 or newer, and npm.
- A Cloudflare account with **R2 enabled** (dashboard → R2; it needs a payment
  card on file, the free tier is enough).
- A **domain on Cloudflare** for the API (for example `api.mystore.com`) and,
  for a storefront on Cloudflare, for the shop (`mystore.com`). See step 8.
- Wrangler signed in:

  ```bash
  npx wrangler whoami        # not signed in: npx wrangler login
  ```

  If it lists several accounts, ask which one to use.

## Step 1 — Install

```bash
npm ci                                   # repo root: API server, dashboard, shared code
(cd cod-astro/theme-00 && npm ci)        # the storefront has its own lockfile
```

Never create a lockfile inside `cod-server`, `cod-client-astro` or `cod-shared`.

## Step 2 — Choose the names

Ask the developer for a short, unique prefix (`<p>`, for example `mystore`).
Names must not collide with another store in the same account: Worker names,
queue names and **Workflow names are unique per account**, and deploying a
duplicate overwrites or breaks the other store.

| What | Name |
| --- | --- |
| API server Worker | `<p>-server` (deployed as `<p>-server-production`, see step 7) |
| Dashboard Worker | `<p>-dashboard` |
| Storefront Worker | `<p>-storefront` |
| D1 database | `<p>-db` |
| R2 bucket | `<p>-media` |
| Queue | `<p>-events` |
| Workflows | `<p>-capi-workflow`, `<p>-lp-image-upload-workflow`, `<p>-review-media-workflow` |

## Step 3 — Create the resources

```bash
npx wrangler d1 create <p>-db                              # note database_id
npx wrangler r2 bucket create <p>-media
npx wrangler kv namespace create <p>-rate-limit            # API server: RATE_LIMIT
npx wrangler kv namespace create <p>-oauth                 # API server: OAUTH_KV (MCP sign-in)
npx wrangler kv namespace create <p>-dashboard-rate-limit  # dashboard: RATE_LIMIT_KV
npx wrangler queues create <p>-events
```

Record the D1 `database_id` (a UUID) and the three KV `id`s (32 hex
characters). If a name is taken, choose another; never reuse the existing
resource. If an ID cannot be read from the output, stop and show the output
to the developer.

## Step 4 — Fill the configuration

```bash
cp .env.example .env
cp cod-server/wrangler.toml.example cod-server/wrangler.toml
cp cod-client-astro/wrangler.toml.example cod-client-astro/wrangler.toml
cp cod-server/.dev.vars.example cod-server/.dev.vars
cp cod-client-astro/.dev.vars.example cod-client-astro/.dev.vars
cp cod-astro/theme-00/.dev.vars.example cod-astro/theme-00/.dev.vars
```

All of these are gitignored. Confirm it before writing any real value:

```bash
git status --short .env cod-server/wrangler.toml cod-client-astro/wrangler.toml
# must print nothing
```

**Root `.env`** — read by the database, seed, storage and storefront deploy
scripts:

```bash
COD_ACCOUNT_ID=<account id>
COD_DB_NAME=<p>-db
COD_R2_BUCKET_NAME=<p>-media
COD_SERVER_URL=https://api.<domain>        # the API's public address (step 8)
```

**`cod-server/wrangler.toml`.** The top of the file is local development; the
`[env.production]` blocks are what the deployed API server uses. In **both**:

- `name = "<p>-server"` (top line only);
- `[[d1_databases]]`: `database_name = "<p>-db"` and its `database_id`
  (the top-level one is also what the migration scripts read);
- `[[r2_buckets]]`: `bucket_name = "<p>-media"`;
- `[[kv_namespaces]]`: `RATE_LIMIT` and `OAUTH_KV` with their IDs;
- the queue: `queue = "<p>-events"` in the producer **and** the consumer;
- the three `[[workflows]]`: `name = "<p>-capi-workflow"` and so on, keeping
  each `binding` and `class_name`;
- `[[ratelimits]]`: a `namespace_id` no other store in the account uses
  (any positive integer).

`[env.production]` has one `vars = { … }` line, and it replaces the top-level
`[vars]` entirely: every production value goes on that line. Set the real
values (the domains of step 8):

```toml
ENVIRONMENT = "production"
WORKER_URL = "https://api.<domain>"
WORKER_SELF_URL = "https://api.<domain>/"
BETTER_AUTH_URL = "https://dashboard.<domain>/api/auth"
ALLOWED_ORIGINS = "https://dashboard.<domain>,https://<domain>"
STOREFRONT_URL = "https://<domain>"
```

`BETTER_AUTH_URL` must be the dashboard's address: the API server checks every
dashboard request against the dashboard's public keys there. `ENVIRONMENT =
"production"` turns on the `ALLOWED_ORIGINS` check; without it the API answers
any website. The media values come in step 5.

**`cod-client-astro/wrangler.toml`:**

- `name = "<p>-dashboard"`;
- `[[d1_databases]]`: the same `database_name` and `database_id`;
- `[[kv_namespaces]]` `RATE_LIMIT_KV`: the `<p>-dashboard-rate-limit` ID;
- `[vars]`: `PUBLIC_APP_URL = "https://dashboard.<domain>"`,
  `PUBLIC_API_URL = "https://api.<domain>"`, and `PUBLIC_TRUSTED_ORIGINS`
  listing every address the dashboard is opened from (its custom domain, and
  its `workers.dev` address if used).

`PUBLIC_API_URL` is written into the dashboard's code when it is built: set it
in `wrangler.toml` (production) and in `cod-client-astro/.dev.vars` (local,
`http://localhost:8787`), never in `cod-client-astro/.env`, which the build
ignores.

**`cod-astro/theme-00/wrangler.jsonc`:** `"name": "<p>-storefront"`.

**Check that no example value is left:**

```bash
grep -n "= \"codflow-server\"\|= \"codflow-dashboard\"\|00000000\|<your-\|your_\|your-store\|example\.com\|codflow-images\|codflow-os-db\|codflow-db\|codflow-events\|\"capi-workflow\|\"lp-image\|\"review-media" \
  cod-server/wrangler.toml cod-client-astro/wrangler.toml
```

Only comment lines may match. Fix every other hit before going on.

## Step 5 — Choose where images live

Ask the developer. A store keeps its images where they start, so decide now.

- **ImageKit (recommended: fast in Algeria).** They need the URL endpoint
  (`https://ik.imagekit.io/<id>`), the public key and the private key
  (ImageKit → Developer options). In `[env.production]` `vars`:

  ```toml
  MEDIA_HOST = "imagekit"
  MEDIA_DELIVERY = "imagekit"
  MEDIA_ORIGIN = "https://ik.imagekit.io/<id>/stores/<p>"
  IMAGEKIT_PUBLIC_KEY = "public_…"
  IMAGEKIT_FOLDER = "/stores/<p>"
  ```

  The private key is a secret (step 7). With R2 instead, remove the two
  `IMAGEKIT_*` keys from the line.
- **Cloudflare R2 on their domain.** Connect a custom domain to the bucket
  (`media.<domain>`, R2 → bucket → Settings) and turn on **Images →
  Transformations** for that zone, or resized pictures do not load:

  ```toml
  MEDIA_HOST = "r2"
  MEDIA_DELIVERY = "cloudflare"
  MEDIA_ORIGIN = "https://media.<domain>"
  ```

The R2 bucket is needed either way: uploads wait there before they are
prepared. Local development needs nothing: the top-level values serve the
local bucket through the local server. The storefront takes no media setting;
the API tells it. Details: `cod-docs/pages/self-hosting/media.mdx`.

## Step 6 — Generate the keys

Generate each once and keep it for the credentials file (step 10):

```bash
openssl rand -hex 32      # STORE_API_KEY           the storefront's key to the API
openssl rand -hex 32      # BETTER_AUTH_SECRET      the dashboard's sign-in secret
openssl rand -hex 32      # MCP_LOGIN_TICKET_SECRET the same on the API server and the dashboard
openssl rand -hex 32      # REVIEW_UPLOAD_SECRET    the API server's review uploads
(cd cod-astro/theme-00 && npx astro create-key)   # ASTRO_KEY the storefront build's key
```

Put the local values in the `.dev.vars` files if the developer will also run
the store locally (`cod-docs/pages/self-hosting/local.mdx`).

## Step 7 — Database, then the three Workers

**The database.** Migrate the local copy too: the admin seeder writes both.

```bash
cd cod-server
npm run db:migrate:local
npm run db:migrate:remote
STORE_API_KEY=<STORE_API_KEY> npm run db:seed:remote
npm run r2:lifecycle
```

`db:seed:remote` creates the store, its API key (it keeps only a hash), the
menus, the default collections, the four legal pages and a shipping profile.
Running it again changes nothing the store has. The starter catalog with
photos is not part of a self-hosted setup: its pictures are not in this
repository. `r2:lifecycle` deletes uploads that were never used, after a day.

**The API server.** It deploys with its production settings, as
`<p>-server-production`:

```bash
npm run deploy -- --env production
```

Then its secrets, on the same Worker:

```bash
printf '%s' '<value>' > ~/.wocart-secret && chmod 600 ~/.wocart-secret
npx wrangler secret put MCP_LOGIN_TICKET_SECRET --env production < ~/.wocart-secret
# repeat for REVIEW_UPLOAD_SECRET, and IMAGEKIT_PRIVATE_KEY with ImageKit
rm ~/.wocart-secret
```

**The dashboard.**

```bash
cd ../cod-client-astro
npm run deploy
npx wrangler secret put BETTER_AUTH_SECRET < ~/.wocart-secret        # same file pattern
npx wrangler secret put MCP_LOGIN_TICKET_SECRET < ~/.wocart-secret   # the API server's value
ADMIN_EMAIL=<email> ADMIN_NAME=<name> npm run seed:admin:remote
```

`npm run deploy` builds first, keeps local values out of the build, and stops
if the result would call `localhost`. `seed:admin:remote` prints the admin's
password and a merchant API key once: copy them into the credentials file.

**The storefront.** Ask: Cloudflare or Vercel.

- **Cloudflare:**

  ```bash
  cd ../cod-astro/theme-00
  ASTRO_KEY=<ASTRO_KEY> npm run deploy
  npx wrangler secret put STORE_API_KEY < ~/.wocart-secret
  ```

  The deploy takes `COD_SERVER_URL` from the root `.env` and refuses a
  `localhost` value. Passing `ASTRO_KEY` keeps it the same across deploys, so
  pages already cached keep working. This Worker has no `workers.dev`
  address: it is reached only through the domain added in step 8.
- **Vercel:** from `cod-astro/theme-00`, link a project and set its
  environment, then deploy:

  ```bash
  npx vercel link
  printf 'vercel' | npx vercel env add DEPLOY_TARGET production
  printf '%s' 'https://api.<domain>' | npx vercel env add COD_SERVER_URL production
  npx vercel env add STORE_API_KEY production < ~/.wocart-secret
  npx vercel env add ASTRO_KEY production < ~/.wocart-secret
  npx vercel --prod
  ```

  `DEPLOY_TARGET=vercel` is what makes the build produce a Vercel site.

## Step 8 — Domains

Cloudflare blocks one `*.workers.dev` Worker from calling another (error
1042), so **the API must be on the developer's domain**. In the Cloudflare
dashboard, open each Worker → **Settings → Domains & Routes → Add → Custom
domain**:

| Worker | Domain |
| --- | --- |
| `<p>-server-production` | `api.<domain>` |
| `<p>-dashboard` | `dashboard.<domain>` (its `workers.dev` address also works) |
| `<p>-storefront` | `<domain>` (required on Cloudflare) |

If an address changed from what step 4 assumed, update it everywhere and
redeploy what changed:

| File | Values | Redeploy |
| --- | --- | --- |
| `cod-server/wrangler.toml` `[env.production]` | `WORKER_URL`, `WORKER_SELF_URL`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `STOREFRONT_URL` | `npm run deploy -- --env production` |
| `cod-client-astro/wrangler.toml` | `PUBLIC_APP_URL`, `PUBLIC_API_URL`, `PUBLIC_TRUSTED_ORIGINS` | `npm run deploy` (rebuilds) |
| root `.env` | `COD_SERVER_URL` | the storefront's deploy |

## Step 9 — Verify

Do not go on past a failing check.

| Check | Expected |
| --- | --- |
| `curl -s -o /dev/null -w "%{http_code}\n" https://api.<domain>/api/docs` | `200` |
| `curl -s -X POST https://dashboard.<domain>/api/auth/sign-in/email -H "Content-Type: application/json" -H "Origin: https://dashboard.<domain>" -d '{"email":"<admin>","password":"<password>"}'` | `200` and the user |
| The developer signs in to the dashboard | the orders screen loads |
| The developer opens the storefront | the home page shows the store |
| The developer places a test order on the storefront | it appears in the dashboard's orders |

Always send the `Origin` header: without it the check passes while real
browsers are refused. While a check fails, read the Worker's errors:
`npx wrangler tail <worker-name> --format pretty`.

## Step 10 — Hand over

Write a credentials file **outside the repository**, readable only by the
developer (`chmod 600`, for example `~/wocart-<p>-credentials.md`), with every
value in its own code block: the admin email and password, the merchant API
key, `STORE_API_KEY`, `BETTER_AUTH_SECRET`, `MCP_LOGIN_TICKET_SECRET`,
`REVIEW_UPLOAD_SECRET`, `ASTRO_KEY`, and the three addresses. Read values from
the files and command output, never retype them. Show secrets in the chat at
most once, and tell the developer to move them to a password manager.

Then print what was created:

| Resource | Name | ID | Where it is bound |
| --- | --- | --- | --- |
| D1 | `<p>-db` | `<uuid>` | both `wrangler.toml` files |
| R2 | `<p>-media` | — | `cod-server/wrangler.toml` |
| KV | `<p>-rate-limit`, `<p>-oauth` | `<ids>` | `cod-server/wrangler.toml` |
| KV | `<p>-dashboard-rate-limit` | `<id>` | `cod-client-astro/wrangler.toml` |
| Queue | `<p>-events` | — | `cod-server/wrangler.toml` |
| Workers | `<p>-server-production`, `<p>-dashboard`, `<p>-storefront` | — | their domains |

And tell them how updates work: "When Wocart publishes an update, ask your AI
agent to *update Wocart*. It follows the `wocart-update` skill in this
repository: it keeps your resources, secrets and data, applies what is new,
and redeploys. You never run this setup again."

## Optional features

All are off until the merchant turns them on in the dashboard (**Apps**):
Meta Pixel and Conversions API, WhatsApp phone verification (DZVerify), bot
protection (Turnstile), email (Sendili), the WhatsApp button, Telegram
notifications and reviews. Carriers are added under delivery companies;
Yalidine and ZR Express each need their webhook secret. Offer them after
step 9, never set them up unasked. Guides: `cod-docs/pages/features/`.

## Running locally

```bash
cd cod-server && npm run db:setup:local && npm run dev        # http://localhost:8787
cd cod-client-astro && npm run seed:admin && npm run dev      # http://localhost:4321
cd cod-astro/theme-00 && npm run dev -- --port 4322           # http://localhost:4322
```

Local data lives in `.wrangler-shared/` at the repository root, shared by the
API server and the dashboard. Signing in against an unmigrated local database
is the usual reason the local dashboard "does not work".

## Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| Every Wrangler command: `Authentication error [code: 10000]` | A stale `CLOUDFLARE_ACCOUNT_ID` in the shell | `unset CLOUDFLARE_ACCOUNT_ID` |
| `wrangler r2 bucket create` fails | R2 is not enabled | Enable R2 in the dashboard (payment card, free tier), retry |
| Deploy fails on a binding | An example value is left | Re-run the step 4 check |
| Deploy fails: a Workflow or queue already exists | The name belongs to another store in the account | Use this store's prefix (step 2) |
| Sign-in answers 500 | The deployed database is not migrated | `npm run db:migrate:remote` in `cod-server` |
| Sign-in answers `403 INVALID_ORIGIN` | The dashboard's address is not in `PUBLIC_TRUSTED_ORIGINS` | Add it, `npm run deploy` in `cod-client-astro` |
| Signed in, but every screen fails with 401 | The API server cannot check the dashboard's sign-in | `BETTER_AUTH_URL` must be the dashboard's `/api/auth` address and `WORKER_SELF_URL` the API's own, in `[env.production]`; redeploy the API |
| The dashboard calls `localhost` | It was built with the local `PUBLIC_API_URL` | `npm run deploy` in `cod-client-astro` (it rebuilds) |
| The storefront shows an unavailable store | It cannot reach the API | `COD_SERVER_URL` must be the API's domain (not `workers.dev`, not `localhost`), and `STORE_API_KEY` the key given to `db:seed:remote` |
| The storefront has no address | Theme-00 does not use `workers.dev` | Add its custom domain (step 8) |
| Storefront deploy refuses `COD_SERVER_URL` | The root `.env` still says `localhost` | Set the API's domain, deploy again |
| Image uploads fail with `MEDIA_NOT_CONFIGURED` | A media value or the ImageKit secret is missing | Step 5 and step 7, then redeploy the API |
| Resized pictures do not load on R2 | Images Transformations are off for the zone | Turn them on for the media domain's zone |
| The local storefront crashes with `Missing field 'moduleType'` | Two Vite versions installed | `rm -rf node_modules && npm ci` (repo root, and in `cod-astro/theme-00`) |
| `Address already in use` on 8787 or 4321 | Another dev server is running | Stop it, or run the storefront with `--port 4322` |
