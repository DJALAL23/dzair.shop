---
name: wocart-setup
description: >-
  Setup runbook for CodFlow — an AI agent following it authenticates with Cloudflare,
  creates the required resources (D1, R2, KV) in the developer's account, binds their real
  IDs into both wrangler.toml files, configures secrets, applies migrations and seeds demo
  data against the remote D1 database, deploys the backend and dashboard to Cloudflare,
  and deploys the storefront to either Cloudflare Workers or Vercel based on developer choice.
  Use when a developer wants to set up CodFlow (development or production), bind Cloudflare
  resources, run migrations, seed sample data, create an admin user, or deploy the platform.
---

# CodFlow Setup — Agent Runbook

CodFlow is a cash-on-delivery (COD) e-commerce platform built on Cloudflare
Workers (backend API + dashboard), Astro 7, and D1 SQLite. The storefront
(`cod-astro/theme-00`) supports dual deployment targets: **Cloudflare Workers**
or **Vercel**. This runbook takes a fresh clone to a fully working, verified
deployment.

Every setup **creates real Cloudflare resources** in the developer's account,
**binds their real IDs** into the wrangler.toml files, and **migrates and seeds
that same database**. There is exactly one path — follow it in order and do not
skip a gate.

The dashboard is `cod-client-astro` (Astro, prerendered static + auth
worker). The storefront is `cod-astro/theme-00` (Astro).

## Before Starting — State This Contract

State this to the developer before running anything:

> *"This setup will create D1 `<project>-db`, R2 bucket `<project>-images`, and
> two KV namespaces in your Cloudflare account `<account>`, bind their real
> IDs into both `wrangler.toml` files, and migrate + seed the D1 database in
> your account. Nothing is left on placeholder values.
> 
> The backend API and dashboard run on Cloudflare Workers. For the customer
> storefront (`cod-astro/theme-00`), you can deploy to:
> - **Vercel (Recommended)**: Solves Cloudflare Error 1042 (Worker-to-Worker fetch
>   block) when `cod-server` is on a free `*.workers.dev` subdomain, provides
>   generous bandwidth and automatic preview deployments.
> - **Cloudflare Workers**: Keeps all services in one Cloudflare account (requires
>   a custom domain or route for `cod-server` in production to avoid error 1042)."*

Both `cod-server/wrangler.toml` and `cod-client-astro/wrangler.toml` ship with
all-zero placeholder resource IDs. After Step 3 of this runbook, **no
placeholder may remain anywhere in either file** — deploys fail or silently
break with placeholders.

## Prerequisites

- Node.js ≥ 22.12 and npm.
- Cloudflare authentication:
  ```bash
  npx wrangler whoami    # if not logged in: npx wrangler login (browser OAuth)
  ```
- R2 must be enabled on the account (requires a payment card on file, free
  tier): confirm dash.cloudflare.com → R2 shows enabled before creating buckets.
- Ports 4321 / 8787 free if services will run locally:
  ```bash
  lsof -nP -iTCP:4321 -iTCP:8787 -sTCP:LISTEN   # expect no output
  ```
  Processes on these ports often belong to ANOTHER checkout's dev servers;
  identify via `ps -p <pid>` and confirm with the human before killing.

If `whoami` lists multiple accounts, ask the developer which one to use and
record that `account_id`.

**CRITICAL: Strip stale `CLOUDFLARE_ACCOUNT_ID` everywhere.** If the shell
exports `CLOUDFLARE_ACCOUNT_ID` for an account the OAuth token cannot access,
every wrangler command fails with `Authentication error [code: 10000]` —
including npm scripts (which invoke wrangler) and seeders. Shell rc files
re-export this variable in every new shell. **Prefix EVERY wrangler invocation**
with `env -u CLOUDFLARE_ACCOUNT_ID` so it targets the logged-in account, or
`unset CLOUDFLARE_ACCOUNT_ID` once per session. Examples throughout this
runbook show the prefix inline where practical.

---

## Step 1 — Install Dependencies (one command)

CodFlow is an **npm workspace monorepo**: one root `package.json`, one root
`package-lock.json`. Never create per-package lockfiles.

```bash
npm ci        # at the repo root — installs all workspaces
```

Sanity check (optional): `npm ls vite` must show a single Vite major across all
workspaces (the root `overrides` pin enforces it).

## Step 2 — Create Dedicated Cloudflare Resources

Create fresh, dedicated resources for this CodFlow install. Default project
name is `codflow`; use the developer's preferred prefix (`<project>`)
otherwise.

```bash
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler d1 create <project>-db                  # capture database_id
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler r2 bucket create <project>-images
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler kv namespace create RATE_LIMIT          # capture id
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler kv namespace create OAUTH_KV            # capture id (MCP OAuth)
```

Rules:
- Always create new resources for this setup. Never bind to a resource that
  already exists in the account — it may belong to another application or
  store, and running migrations/seed against it would write into foreign data.
- **Unique names apply to WORKER names, not just resources.** Default worker
  `name` fields in wrangler configs collide across clones, and deploying
  silently overwrites another installation. Require the developer to choose a
  unique prefix (e.g. `mystore-server`, `mystore-dashboard`, `mystore-storefront`)
  and update the `name` field in all three wrangler files before first deploy.
  This prevents cross-clone overwrite.
- If a resource name is taken, do not reuse the existing resource: choose a
  fresh, unique name (e.g. append the store name or a short suffix) and create
  again.
- Capture the D1 `database_id` (UUID) and both KV `id`s (32-hex) from command
  output. If parsing fails → hard stop, print the raw output, ask the
  developer. Never fall back to placeholder values.
- Create **two** KV namespaces (rate limiting + MCP OAuth provider). Binding
  names differ per file: cod-server uses `RATE_LIMIT` + `OAUTH_KV`;
  cod-client-astro uses `RATE_LIMIT_KV` (its own namespace, only the `id`
  matters).

## Step 3 — Bind Real IDs into BOTH wrangler.toml Files

```bash
cp cod-server/wrangler.toml.example cod-server/wrangler.toml
cp cod-client-astro/wrangler.toml.example cod-client-astro/wrangler.toml
```

Files: `cod-server/wrangler.toml` **and** `cod-client-astro/wrangler.toml`.

- `[[d1_databases]]`: set `database_id` (same database in both files).
- `[[kv_namespaces]]`: set `id`s.
- `[[r2_buckets]]`: confirm `bucket_name` matches the bucket created in Step 2.

Then read both files back and verify no placeholder remains anywhere,
including `[env.production]` blocks:

```bash
grep -rn "00000000-0000\|00000000000000000000000000000000" \
  cod-server/wrangler.toml cod-client-astro/wrangler.toml
# expected: no matches — fix any hit before continuing
```

**Set the D1 database name once:** the scripts are not hardcoded — the seeders,
the migration wrapper (`cod-server/scripts/d1.mjs`) and the R2 setup all read
`COD_DB_NAME` from `<repo-root>/.env` via `cod-server/scripts/cloud-env.mjs`
(precedence: `process.env` > `.env` > default). Set it there:

```bash
cp .env.example .env      # at the repo root
# COD_DB_NAME=<your database name>
# COD_SERVER_URL=https://<your api domain>  # required BEFORE Theme-00 deploy —
#   npm run deploy refuses a localhost value (the default) without --force-local
```

The `database_name` / `database_id` in each `wrangler.toml` still has to match
the database you created — those are wrangler's own config, not script input.
Confirm no script or config still pins the sample name:

```bash
grep -r "codflow-os-db" --exclude-dir=node_modules --exclude-dir=.git
# expected: only .env.example defaults and documentation, zero script hits
```

Confirm the filled `wrangler.toml` files are not tracked by git:

```bash
git status cod-server/wrangler.toml cod-client-astro/wrangler.toml
# expected: nothing listed (both ignored)
```

If either file appears in `git status`, stop — the `.gitignore` is not applied
correctly. Do not continue until both are untracked.

While editing, also replace the example domains in `[vars]` /
`[env.production.vars]` (`WORKER_URL`, `BETTER_AUTH_URL`, `WORKER_SELF_URL`,
`PUBLIC_APP_URL`, `PUBLIC_API_URL`, `PUBLIC_TRUSTED_ORIGINS`) with the
developer's real URLs when they are known; localhost defaults are correct for
local runs. The storefront's `COD_SERVER_URL` is NOT set in
`cod-astro/theme-00/wrangler.jsonc` — it is injected at deploy time by
`npm run deploy` from `COD_SERVER_URL` in the root `.env`.

Also create the dashboard's build-time client env:

```bash
cd cod-client-astro && cp .env.example .env
```

Leave `PUBLIC_API_URL` out of that file. It is inlined into the browser bundle
by `astro:env/client`, but the Cloudflare adapter pushes wrangler values and
`.dev.vars` into `process.env`, and Astro loads env with an empty prefix, so
Vite's final `process.env` pass outranks the `.env` files:

```
.dev.vars  >  wrangler.toml [vars]  >  process.env  >  .env
```

A value in `.env` is silently ignored. Set the production origin in
`cod-client-astro/wrangler.toml` `[vars]`, and the local one in `.dev.vars`
(`PUBLIC_API_URL=http://localhost:8787`).

## Step 3b — Choose Where Images Live

Images are kept on ImageKit or in the developer's R2 bucket, and shoppers' browsers
fetch them through the delivery this server is configured with. The R2 bucket from
Step 2 is always needed: it holds *Staging*, where uploads wait to be prepared. It
needs no CORS policy and no API token, because cod-server writes to it through its
own binding.

### Agent instructions

Ask the developer which host to use. Both work. A store keeps its images where they
start, so decide now.

- **Option A — ImageKit (recommended: loads fast in Algeria).** Ask for the URL endpoint
  (`https://ik.imagekit.io/<id>`), the public key and the private key from ImageKit →
  Developer options. The folder is this store's own, e.g. `/stores/<store-name>`.
- **Option B — Cloudflare R2 behind the developer's domain.** Ask for the bucket's
  custom domain (e.g. `media.yourdomain.com`). Its zone must have **Images →
  Transformations** turned on, or resized photos do not load.

### 1. Set the media variables in wrangler.toml

Write them under `[vars]`, and the same ones in `[env.production]`. Option A:

```toml
MEDIA_HOST = "imagekit"
MEDIA_DELIVERY = "imagekit"
MEDIA_ORIGIN = "https://ik.imagekit.io/<id>/stores/<store-name>"
IMAGEKIT_PUBLIC_KEY = "public_..."
IMAGEKIT_FOLDER = "/stores/<store-name>"
```

Option B:

```toml
MEDIA_HOST = "r2"
MEDIA_DELIVERY = "cloudflare"
MEDIA_ORIGIN = "https://media.yourdomain.com"
```

`MEDIA_ORIGIN` is where the host serves the store's files: the ImageKit URL endpoint
followed by the folder, or the R2 custom domain. Option B needs no secret.

### 2. Set the ImageKit private key (Option A only)

The private key is a secret, never a `wrangler.toml` value. After cod-server is
deployed (Step 6), set it with stdin redirect so it is never echoed:

```bash
printf '<IMAGEKIT_PRIVATE_KEY>' | env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put IMAGEKIT_PRIVATE_KEY --name <server-worker-name>
```

### 3. Local development

Locally the defaults need no account: `MEDIA_HOST=r2`, `MEDIA_DELIVERY=direct` and
`MEDIA_ORIGIN=http://localhost:8787/media` serve the local bucket through this server.
Nothing goes in `.dev.vars` unless the developer wants ImageKit locally.

### 4. The storefront needs nothing

The storefront takes no media variable, on Cloudflare or on Vercel. The server tells it
how images are delivered in its store configuration (`media`), so there is no
`MEDIA_DOMAIN` step.

### 5. Redeploy cod-server

```bash
cd cod-server && env -u CLOUDFLARE_ACCOUNT_ID npm run deploy
```

### Verify

Ask for an upload ticket. It writes nothing; the server answers how a file would be sent:

```bash
curl -s -X POST https://<api-domain>/api/media/uploads \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <admin-api-key>" \
  -d '{"folder":"products","contentType":"image/jpeg","bytes":1024}'
```

`data.send.kind` is `form` on ImageKit (the browser posts to `upload.imagekit.io`) and
`relay` on R2 (the browser sends the bytes to this server).

Then check what the storefront is told:

```bash
curl -s -H "X-Store-API-Key: <store-api-key>" https://<api-domain>/store/config
```

Its `media` field must show the delivery and origin set in Step 1.

If the ticket answers `MEDIA_NOT_CONFIGURED`, one of `MEDIA_HOST`, `MEDIA_DELIVERY` or
`MEDIA_ORIGIN` is missing, or the ImageKit secret is not set on the Worker.

---

## Step 4 — Generate Keys & Configure Secrets

Generate the keys once and keep them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))" # STORE_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"       # MCP_LOGIN_TICKET_SECRET
```

**Deploy workers BEFORE setting secrets:** In non-interactive sessions,
`wrangler secret put` against a nonexistent worker fails or hangs on the create
prompt. Either deploy each worker first (Step 6), or wait until after deploy to
set secrets. When setting secrets, provide values via stdin redirect from a
chmod-600 temp file — never use `echo` or heredocs, which leak secrets into
shell history and process lists:

```bash
# After cod-server is deployed:
cd cod-server
echo "<BETTER_AUTH_SECRET_value>" > /tmp/secret.txt && chmod 600 /tmp/secret.txt
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put BETTER_AUTH_SECRET < /tmp/secret.txt
echo "<MCP_LOGIN_TICKET_SECRET_value>" > /tmp/secret.txt
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put MCP_LOGIN_TICKET_SECRET < /tmp/secret.txt
rm /tmp/secret.txt

# After cod-client-astro is deployed — SAME two values (must match cod-server):
cd ../cod-client-astro
echo "<BETTER_AUTH_SECRET_value>" > /tmp/secret.txt && chmod 600 /tmp/secret.txt
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put BETTER_AUTH_SECRET < /tmp/secret.txt
echo "<MCP_LOGIN_TICKET_SECRET_value>" > /tmp/secret.txt
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put MCP_LOGIN_TICKET_SECRET < /tmp/secret.txt
rm /tmp/secret.txt

# Theme-00: STORE_API_KEY (same string the seeder will hash in Step 5)
# If deploying storefront to Cloudflare Workers:
#   echo "<STORE_API_KEY_value>" > /tmp/secret.txt && chmod 600 /tmp/secret.txt
#   env -u CLOUDFLARE_ACCOUNT_ID npx wrangler secret put STORE_API_KEY < /tmp/secret.txt --name <storefront-worker-name>
#   rm /tmp/secret.txt
# If deploying storefront to Vercel:
#   cd cod-astro/theme-00 && printf "<STORE_API_KEY_value>" | npx vercel env add STORE_API_KEY production
```

For services that will also run locally, create `.dev.vars` from each package's
`.dev.vars.example` with the same key values (`.dev.vars` is gitignored).

Keep `STORE_API_KEY` at hand: Step 5 seeds its hash into the database, so the
storefront secret and the seeded hash must come from the identical string.

## Step 5 — Migrate & Seed the Cloudflare D1 Database

**Remote migrations are mandatory.** All schema and demo data go against the D1
created in Step 2 (remote), not an emulated copy. Both local and remote
migrations must run:

```bash
cd cod-server
env -u CLOUDFLARE_ACCOUNT_ID npm run db:migrate:local   # REQUIRED first: seed-admin writes local + remote
env -u CLOUDFLARE_ACCOUNT_ID npm run db:migrate:remote  # MANDATORY: deployed sign-in 500s without this
env -u CLOUDFLARE_ACCOUNT_ID STORE_API_KEY=<generated-store-key> npm run db:seed:remote   # the store, its API key, menus, collections, legal pages, shipping

cd ../cod-client-astro
ADMIN_EMAIL=admin@example.com ADMIN_NAME=Admin npm run seed:admin:remote
```

Notes:
- `db:migrate:local` must run before `seed-admin`: the script seeds the
  emulated local D1 first and needs its schema to exist.
- `db:migrate:remote` is MANDATORY before any deployed sign-in attempt —
  without it, Better Auth 1.7 schema requirements fail (`field "alg" does not
  exist in "jwkss"`), producing 500 errors.
- The seeder writes better-auth ≥ 1.7 credential rows (`issuer =
  'local:credential'`, `account_id = user id`) — re-run it after any password
  reset request for the seeded admin.
- Verify the seeder reports all statements executed and note the admin
  email/password and API key output — they appear once.

## Step 6 — Deploy in Dependency Order + Smoke Test

Deploy the services in order: Backend API first, then Dashboard, then Storefront.

### 6.1 Deploy Backend & Dashboard (Cloudflare Workers)

```bash
cd cod-server          && env -u CLOUDFLARE_ACCOUNT_ID npm run deploy
cd ../cod-client-astro && env -u CLOUDFLARE_ACCOUNT_ID npm run deploy     # wrangler deploy (builds first: npm run build)
```

### 6.2 Deploy Storefront (`cod-astro/theme-00`)

Deploy the storefront to either **Cloudflare Workers** OR **Vercel** based on developer preference:

#### Option A: Deploy Storefront to Cloudflare Workers
```bash
cd cod-astro/theme-00 && env -u CLOUDFLARE_ACCOUNT_ID npm run deploy     # astro build && wrangler deploy
```
> [!NOTE]
> **workers.dev limitation (Error 1042):** Cloudflare blocks Worker→Worker `fetch()`
> between two `*.workers.dev` hosts. If `cod-server` is deployed on `*.workers.dev`,
> a storefront on `*.workers.dev` cannot load products from it. For a Cloudflare-hosted
> storefront in production, put `cod-server` on a custom domain/route and update
> `COD_SERVER_URL`.

#### Option B: Deploy Storefront to Vercel (Recommended when cod-server is on workers.dev)
Deploying the storefront to Vercel bypasses Cloudflare Error 1042 completely and takes advantage of Vercel's global Edge network and instant preview branches.
Full details: https://docs.wocart.store/self-hosting/deploy.

Using Vercel CLI:
```bash
cd cod-astro/theme-00
npx vercel link                                     # link or create project
printf "vercel" | npx vercel env add DEPLOY_TARGET production
printf "https://<your-cod-server-url>" | npx vercel env add COD_SERVER_URL production
printf "<your-raw-store-api-key>" | npx vercel env add STORE_API_KEY production
npx vercel --prod                                   # builds with npm run build:vercel and deploys
```

**After deploy, replace localhost URL vars with real deployed URLs and
redeploy:** Once workers are live, set `PUBLIC_APP_URL` /
`PUBLIC_API_URL` / `PUBLIC_TRUSTED_ORIGINS` (cod-client-astro wrangler.toml
`[vars]`), `WORKER_URL`, `WORKER_SELF_URL`, `BETTER_AUTH_URL` (cod-server
wrangler.toml `[vars]`), and `COD_SERVER_URL` (root `.env` — the Theme-00
deploy script reads it) to the actual deployed URLs, then redeploy affected
workers. `PUBLIC_API_URL` is baked into the client bundle at build time, so the
dashboard must be **rebuilt** after changing it; `npm run deploy` does that and
aborts if the built bundle still points at a loopback address. Skipping this
causes browser sign-in failures (R6/R7).

Smoke-test after each deploy; do not continue past a failing check:

| Component | Check | Expectation |
| :--- | :--- | :--- |
| cod-server | `curl -s -o /dev/null -w "%{http_code}" https://<workers-url>/api/docs` | `200` |
| dashboard sign-in API | `curl -s -X POST https://<dashboard-url>/api/auth/sign-in/email -H "Content-Type: application/json" -H "Origin: https://<dashboard-url>" -d '{"email":"<admin>","password":"<pass>"}'` | `200` + user JSON (401 = credentials/schema issue, 500 = config, **403 `INVALID_ORIGIN` = R6 not applied**) |
| dashboard UI | open the dashboard URL | login page loads |
| storefront (CF or Vercel) | open the storefront URL | homepage renders |

**CRITICAL — Origin header in sign-in tests:** Plain curl omits the `Origin`
header; Better Auth skips its origin check and returns 200, while every real
browser request gets `403 INVALID_ORIGIN` (which the UI masks as "Invalid email
or password"). The canonical sign-in check MUST send
`-H "Origin: https://<dashboard-url>"` and expect 200 + user JSON. If browser
login fails but curl without Origin passes, the dashboard origin is missing
from `PUBLIC_TRUSTED_ORIGINS` — apply R6, redeploy, and retest with the Origin
header.

**Diagnose unclear failures with `wrangler tail`:** Run
`env -u CLOUDFLARE_ACCOUNT_ID npx wrangler tail <worker-name> --format pretty`
in the background, have the human retry the failing operation, then read the
log — the true error surfaces there, not in UI text.

**workers.dev limitation (error 1042):** Cloudflare blocks Worker→Worker
`fetch()` between two `*.workers.dev` hosts. A storefront deployed to
workers.dev cannot load products from a cod-server also on workers.dev. For a
production storefront, put cod-server on a custom domain/route and point
`COD_SERVER_URL` at it (or wire a Service Binding), then re-deploy Theme-00 and
confirm `/products` shows the seeded catalog. Local development is unaffected.

## Step 6b — Optional: Transactional Email (Sendili)

Offer this to the developer after the smoke tests pass; skip entirely if they
decline — the feature is inert by default (no `store_email_config` row).

1. Ask the developer to: create a [sendili.com](https://sendili.com) account,
   buy credits, **verify their sending domain** (DNS records in the Sendili
   dashboard), and create an API key (`sk_live_…`).
2. In the deployed dashboard: sign in as admin → **Apps → Sendili** →
   paste the key (domains auto-load) → set the from address by typing the
   local part (`support`, `notify`…) and picking the verified domain →
   toggle **Enable email sending** → **Save**.
3. Verify: **Test connection** shows `Connection OK` with the domain listed;
   then invite a team member with an email the developer can check and
   confirm the invite email arrives (sign-in link + temporary password), and
   that the invited member can sign in.
4. Docs: https://docs.wocart.store/features/email (feature guide).

No wrangler secrets, no worker config — the key lives in D1
(`store_email_config`, applied by migration `0013` in Step 5) and is masked
in every API response.

## Step 7 — Closing Summary (Mandatory)

Print a resource inventory:

> **Tell the developer how to get future updates:** "When CodFlow publishes
> an update, just ask your AI agent to *'update CodFlow'* — it will follow
> the [`wocart-update` runbook](.agents/skills/wocart-update/SKILL.md)
> (shipped in this repo), which pulls the latest code from
> `https://github.com/bighadj22/codflow` main, merges it into this install
> without re-running setup, keeps your resources, secrets, and data intact,
> and redeploys. You never repeat this runbook from scratch."

| Resource | Name | ID | Bound in | Verified by |
| :--- | :--- | :--- | :--- | :--- |
| D1 | `<project>-db` | `<uuid>` | cod-server/wrangler.toml, cod-client-astro/wrangler.toml | `d1 create` output + Step 3 grep |
| R2 | `<project>-images` | n/a (name-bound) | cod-server/wrangler.toml | `r2 bucket create` confirmation |
| KV (rate limit) | rate-limit namespace | `<32-hex>` | cod-server + cod-client-astro wrangler.toml | `kv namespace create` output |
| KV (MCP OAuth) | oauth namespace | `<32-hex>` | cod-server/wrangler.toml | `kv namespace create` output |
| Storefront Target | Cloudflare / Vercel | n/a | cod-astro/theme-00 | Deployed URL smoke test |

**Credentials file delivery (mandatory):** Write credentials to a chmod-600
markdown file OUTSIDE git-tracked directories (e.g. `~/codflow-credentials.md`
or `/tmp/wocart-setup-<timestamp>.md`). Place every value inside a fenced code
block so humans can copy-paste them without trailing-space login failures. Extract values programmatically from `.dev.vars` or source files; never retype from memory. Delete temporary secret files afterward. Show credentials in chat output at most once.

Example credentials file structure:

```markdown
# CodFlow Setup Credentials — <project-name>

## Admin User
- **Email:** `admin@example.com`
- **Password:**
  ```
  <actual-password>
  ```

## API Keys
- **BETTER_AUTH_SECRET:**
  ```
  <base64-value>
  ```
- **MCP_LOGIN_TICKET_SECRET:**
  ```
  <hex-value>
  ```
- **STORE_API_KEY:**
  ```
  <base64url-value>
  ```

## Deployed URLs
- Dashboard: https://<dashboard-url>
- API Server: https://<cod-server-url>
- Storefront: https://<storefront-url> (Cloudflare Workers or Vercel)

**Security:** This file contains sensitive credentials. Store it securely and delete after transferring values to a password manager.
```

---

## Running the Stack Locally During Development

The `npm run dev` scripts execute Workers on the local machine with
Miniflare-emulated storage persisted to `<repo-root>/.wrangler-shared` — they
do not read the deployed D1. To boot all three services locally:

```bash
cd cod-server && npm run db:migrate:local && STORE_API_KEY=<key> npm run db:seed:local
cd ../cod-client-astro && ADMIN_EMAIL=… ADMIN_NAME=Admin npm run seed:admin
```

Then start one terminal per service:

| Package | Directory | Command | URL |
| :--- | :--- | :--- | :--- |
| API Server | `cod-server` | `npm run dev` | http://localhost:8787 (docs at `/api/docs`) |
| Dashboard | `cod-client-astro` | `npm run dev` | http://localhost:4321 |
| Storefront | `cod-astro/theme-00` | `npm run dev` | http://localhost:4321 — run `astro dev --port 4322` when the dashboard is up |

Localhost→localhost is unaffected by the workers.dev limitation: the storefront
renders the full seeded catalog locally.

The storefront directory is `cod-astro/theme-00` — bare `cod-astro/` has no
scripts.

---

## Troubleshooting

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| **Deploy fails with placeholder-looking binding errors** | Resource IDs were never replaced in wrangler.toml | Re-run the Step 3 verification greps; bind real IDs. |
| **`grep` finds placeholders inside `[env.production]` blocks** | Production block edited incompletely | Replace every all-zero `database_id` / KV `id` occurrence in the file. |
| **Theme-00 dev dies: `Missing field 'moduleType'`** | Dual Vite majors | Root `package.json` overrides pin `vite` to ^8.2.2 (root-only — npm ignores child overrides). `rm -rf node_modules && npm ci`; `npm ls vite` must show one major. |
| **Storefront deployed on Cloudflare but products empty** | Worker→Worker fetch between two `*.workers.dev` hosts blocked (CF error 1042) | Put cod-server on a custom domain/route, set `COD_SERVER_URL`, redeploy Theme-00. Or deploy storefront to Vercel instead. |
| **Storefront on Vercel shows empty products / network error** | `COD_SERVER_URL` missing or protocol omitted | Ensure `COD_SERVER_URL` in Vercel project env starts with `https://` and points to the live `cod-server` worker. |
| **Storefront on Vercel order creation fails with 401** | `STORE_API_KEY` mismatch | Ensure `STORE_API_KEY` on Vercel matches the identical raw key seeded into D1 during Step 5. |
| **Storefront on Vercel fails build: missing adapter** | `DEPLOY_TARGET=vercel` not set | Set `DEPLOY_TARGET=vercel` in Vercel env or build command `npm run build:vercel`. |
| **Sign-in returns 500 `Secondary-storage rate limiting requires SecondaryStorage.increment`** | auth server swapped back to `withCloudflare({ kv })` shortcut | Keep the full custom `secondaryStorage` in `cod-client-astro/src/lib/auth/server.ts`; better-auth-cloudflare@0.3.1 lacks `increment`. |
| **Sign-in returns 401 with correct credentials** | Admin row predates better-auth 1.7 semantics (missing `issuer`, `account_id = email`) | Apply migration 0010, re-run `npm run seed:admin:remote`. |
| **get-session 500: field "alg" does not exist in "jwkss"** | Migration 0011 missing on that database | Run `npm run db:migrate:remote` (or `:local`). |
| **Sign-in works but every API call returns 401** | `BETTER_AUTH_SECRET` differs between cod-server and cod-client-astro — the dashboard-issued JWT fails cod-server's JWKS verification | Set the identical secret on both workers. |
| **Theme-00 boots then wedges/crashes at first render: `optimized dependencies changed. reloading`** | Late SSR dep discovery races the workerd reload ([astro#16933](https://github.com/withastro/astro/issues/16933)) | Keep `vite.environments.ssr.optimizeDeps` (`noDiscovery: true` + excludes) in `astro.config.mjs`. |
| **`Address already in use :8787`** | Another checkout's wrangler holds the port (see Prerequisites port preflight) | Identify via `ps -p <pid>`, confirm with human, then kill that process tree. |
| **`Another astro dev server is already running`** | Astro 7 dev lockfile left behind | `npx astro dev stop` (or kill the stale process). |
| **Astro behaves unexpectedly under an agent (backgrounded, JSON output)** | Astro auto-enables background+JSON mode when `AGENT`, `CLAUDE_CODE_*`, or `OPENCODE` env vars are present | Humans get foreground behavior; agents should use `npx astro dev status` / `logs` / `stop`. |
| **`wrangler login` fails in headless/SSH** | No GUI browser available | Run `npx wrangler login` on a local machine, or configure `CLOUDFLARE_API_TOKEN` in the environment. |
| **`wrangler r2 bucket create` fails** | R2 subscription not enabled on Cloudflare account | Navigate to dash.cloudflare.com → R2, add a payment card to activate the Free Tier, then retry. |
| **Local D1 split-brain / missing tables** | Wrangler ran without `--persist-to` | Always run local migrations and commands with `--persist-to ../.wrangler-shared`. cod-client-astro's astro dev reads the same path via the adapter's `persistState`. |
| **Better Auth 500 on sign-in** | `BETTER_AUTH_SECRET` missing | Ensure `BETTER_AUTH_SECRET` is set in `cod-client-astro/.dev.vars` (local) or via `wrangler secret put` (production). |
| **Image uploads fail in browser** | ImageKit or the R2 host refuses the upload | ImageKit: check `IMAGEKIT_PUBLIC_KEY` and the `IMAGEKIT_PRIVATE_KEY` secret (`MEDIA_HOST_REFUSED` in the server's answer). R2: the server relays the bytes, so no CORS policy is involved. |
| **`MEDIA_NOT_CONFIGURED` on upload** | `MEDIA_HOST`, `MEDIA_DELIVERY` or `MEDIA_ORIGIN` missing from `[vars]`, or `IMAGEKIT_PRIVATE_KEY` not set on the Worker | Set the variables (Step 3b, step 1), the secret (step 2), then redeploy cod-server. |
| **Images show from the Worker URL instead of the store's host** | `MEDIA_ORIGIN` wrong or missing | `MEDIA_ORIGIN` must be where the host serves the store's files (the ImageKit endpoint plus the folder, or the R2 custom domain). Fix it, then redeploy cod-server. |

