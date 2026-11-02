---
name: wocart-update
description: >-
  Update runbook for a self-hosted Wocart store (formerly CodFlow) that is
  already set up. An AI agent following it brings the existing checkout to the
  latest code from https://github.com/bighadj22/codflow (branch main): it backs
  up the database and the configuration, merges the code, adds what the new
  templates need to the gitignored configuration while keeping the store's
  resource IDs, names, domains and secrets, creates only the resources and
  secrets an update introduces, applies new migrations without losing data,
  and redeploys what changed, reporting each step in plain language. Use when
  the developer asks to update or upgrade Wocart (or CodFlow), pull the latest
  release, or apply new migrations. For a first install, use wocart-setup.
---

# Wocart update — agent runbook

Wocart was formerly called CodFlow; folder names, package names and `COD_*`
variables still say CodFlow, and stay that way.

A self-hosted store was set up with the `wocart-setup` skill. Its
configuration (`.env`, both `wrangler.toml` files, the `.dev.vars` files) is
gitignored and holds the store's own IDs and domains. This runbook brings it
to the latest code **without** re-running setup, re-creating resources,
regenerating secrets or re-seeding the store.

**Source:** `https://github.com/bighadj22/codflow`, branch `main`. Never a
fork, never another branch.

**What each release asks for** is listed, newest first, in
`cod-docs/pages/self-hosting/upgrading.mdx` in the checkout. Read the entries
for the migrations this store has not applied yet.

## Rules for the agent

- **Report every step** to the developer before starting the next, in plain
  language: what you did, what it changed, what comes next. They may not be a
  developer. Never dump raw output without a one-line explanation.
- **Ask, never guess,** for anything only they know: a value, a domain, a yes
  or no. Get a go-ahead before migrating or deploying: it touches a live store.
- **Never** regenerate a secret, rename a Worker, a Workflow or a queue,
  re-create a resource that exists, re-seed the store, hand-edit the database,
  or `git reset --hard` without the developer's explicit yes.
- **Wrangler account.** If the shell exports a `CLOUDFLARE_ACCOUNT_ID` the
  login cannot access, every Wrangler command fails with
  `Authentication error [code: 10000]`: `unset CLOUDFLARE_ACCOUNT_ID` once.

## Before starting — state this to the developer

> "I will back up your database and settings, download the latest Wocart
> code, add any new settings it needs while keeping yours, apply the new
> database changes (your data stays), and redeploy what changed. Nothing is
> created from scratch, no password or key changes, and no demo data is added."

## Step 0 — Checks

1. **It is an existing install** (from the repository root):

   ```bash
   test -f .env && test -f cod-server/wrangler.toml && test -f cod-client-astro/wrangler.toml && echo OK
   ```

   Anything missing: stop, this is not a finished setup; use `wocart-setup`.
2. **The right repository:** `git remote get-url origin` should end in
   `bighadj22/codflow.git`. If not, ask where they take updates from, or add
   it: `git remote add upstream https://github.com/bighadj22/codflow.git` and
   use `upstream` instead of `origin` below.
3. **Signed in:** `npx wrangler whoami`.
4. **No local edits in the way:** `git status --porcelain`. The gitignored
   configuration files never show; anything listed is a tracked file the
   developer changed. Show the list and let them choose: keep it on a branch,
   stash it (`git stash push -m "before update" -- <files>`), or discard it
   (only on an explicit yes).
5. **How the API server is deployed — keep it that way.** Read the name:

   ```bash
   grep -m1 '^name' cod-server/wrangler.toml          # name = "<server>"
   npx wrangler deployments list --name <server>-production
   ```

   - If `<server>-production` exists, the store deploys with its production
     settings: **API_DEPLOY = `npm run deploy -- --env production`**, and its
     secrets take `--env production`.
   - Otherwise it was deployed from the top of the file:
     **API_DEPLOY = `npm run deploy`**, secrets without `--env`.

   Use the same form for the whole update. Switching would create a second
   Worker without the store's secrets or domain.
6. **Where the storefront runs:** Cloudflare if `cod-astro/theme-00/.vercel/`
   is absent and the developer confirms; Vercel if it is present. Ask when
   unsure.
7. **The rollback point:**

   ```bash
   git rev-parse --short HEAD | tee ~/.wocart-update-old-head
   ```

## Step 1 — See what is coming (changes nothing)

```bash
git fetch origin main --tags
git rev-list --count HEAD..origin/main
git log --oneline HEAD..origin/main
```

Before merging, record what changed (after the merge these ranges are empty):

| Check | Command | If anything is listed |
| --- | --- | --- |
| Migrations | `git diff --name-only HEAD..origin/main -- cod-server/src/db/migrations` | step 5 |
| Root dependencies | `git diff --name-only HEAD..origin/main -- package.json package-lock.json` | `npm ci` at the root (step 2) |
| Storefront dependencies | `git diff --name-only HEAD..origin/main -- cod-astro/theme-00/package.json cod-astro/theme-00/package-lock.json` | `npm ci` in `cod-astro/theme-00` (step 2) |
| Templates | `git diff --name-only HEAD..origin/main -- '*.example' .env.example cod-astro/theme-00/wrangler.jsonc` | step 3 |
| New secrets or settings | `git diff HEAD..origin/main -- cod-server/src/types/env.ts` | step 4 |
| API server | `git diff --name-only HEAD..origin/main -- cod-server cod-shared` | redeploy it |
| Dashboard | `git diff --name-only HEAD..origin/main -- cod-client-astro cod-shared` | redeploy it |
| Storefront | `git diff --name-only HEAD..origin/main -- cod-astro/theme-00` | redeploy it |

Read the new entries of `CHANGELOG.md` and of `upgrading.mdx`, and present the
plan in plain words ("12 updates, 2 database changes, one new setting,
redeploy the API and the storefront"). Wait for the go-ahead.

If nothing is incoming, the store may still be behind: run step 5's
`migrations list` before saying it is up to date.

## Step 2 — Back up, then merge

Back up the configuration and the database **outside** the repository:

```bash
BK="$HOME/.wocart-backups/$(date +%Y%m%d-%H%M%S)" && mkdir -p "$BK"
cp .env cod-server/wrangler.toml cod-client-astro/wrangler.toml "$BK/"
for f in cod-server/.dev.vars cod-client-astro/.dev.vars cod-astro/theme-00/.dev.vars; do [ -f "$f" ] && cp "$f" "$BK/$(echo $f | tr / _)"; done
(cd cod-server && node scripts/d1.mjs export --remote --output "$BK/database.sql")
ls -la "$BK"
```

Tell the developer the folder: it is their way back. Then merge:

```bash
git merge --ff-only origin/main
```

If it refuses, the checkout has commits of its own
(`git log --oneline origin/main..HEAD`): stop and let the developer decide; do
not force. Reinstall what step 1 flagged: `npm ci` at the root, and
`(cd cod-astro/theme-00 && npm ci)`.

## Step 3 — Bring the configuration up to the new templates

`git pull` updates the templates, never the store's own files. Compare each
pair and add only what the template has and the live file lacks:

| Template | The store's file |
| --- | --- |
| `cod-server/wrangler.toml.example` | `cod-server/wrangler.toml` |
| `cod-client-astro/wrangler.toml.example` | `cod-client-astro/wrangler.toml` |
| `.env.example` | `.env` |
| `<folder>/.dev.vars.example` | `<folder>/.dev.vars` |

```bash
diff cod-server/wrangler.toml.example cod-server/wrangler.toml
diff cod-client-astro/wrangler.toml.example cod-client-astro/wrangler.toml
diff .env.example .env
```

- **Expected differences** — keep the store's: Worker `name`s, every ID,
  `database_name`, `bucket_name`, queue and Workflow `name`s, the
  rate-limit `namespace_id`, every URL and domain, and the media values.
- **Add** what is new: a `[vars]` key, a binding block (KV, R2, queue,
  Workflow, rate limit, `[images]`), a cron in `[triggers]`. In
  `cod-server/wrangler.toml`, add it **both** at the top and in
  `[env.production]`; `[env.production]`'s one `vars = { … }` line replaces
  the top-level vars, so a new production variable goes on that line.
- **Name a new resource after the store**, never with the template's default:
  a new Workflow becomes `<prefix>-<workflow>` like the store's others, a new
  queue `<prefix>-<queue>`.
- **Adopt** a new `compatibility_date` or `compatibility_flags`: the new code
  expects them.
- **A key the template removed:** leave it, mention it, remove it only when
  the developer agrees.
- `COD_SERVER_URL` in `.env` stays the API's public domain.

Then check that no example value came in with a copied block:

```bash
grep -n "00000000\|<your-\|your_\|your-store\|example\.com" cod-server/wrangler.toml cod-client-astro/wrangler.toml
```

Only comment lines may match.

## Step 4 — New resources and secrets only (often nothing)

Releases that ask for something new, with what to do (details for each:
`upgrading.mdx`):

| The store's config lacks | Create or set |
| --- | --- |
| a `[[queues.producers]]` / `[[queues.consumers]]` pair | `npx wrangler queues create <prefix>-events`; name it in both; and `crons = ["0 * * * *", "*/5 * * * *"]` |
| the `REVIEW_MEDIA_WORKFLOW` Workflow or `REVIEW_RATE_LIMITER` | add them; secret `REVIEW_UPLOAD_SECRET` (`openssl rand -hex 32`); run `npm run r2:lifecycle` once in `cod-server` |
| `MEDIA_HOST`, `MEDIA_DELIVERY`, `MEDIA_ORIGIN` | images stored before this release are on R2: `MEDIA_HOST = "r2"`, `MEDIA_DELIVERY = "cloudflare"`, and the bucket's domain as `MEDIA_ORIGIN` (`cod-docs/pages/self-hosting/media.mdx`) |
| a new KV namespace binding | `npx wrangler kv namespace create <prefix>-<name>`, bind its ID |

For a new secret, ask for (or generate) the value and set it on the right
Worker, from a `chmod 600` file outside the repository:

```bash
npx wrangler secret put <NAME> [--env production] < ~/.wocart-secret   # as step 0.5 decided
rm ~/.wocart-secret
```

**Never regenerate** an existing secret. `MCP_LOGIN_TICKET_SECRET` holds the
same value on the API server and the dashboard; `BETTER_AUTH_SECRET` is the
dashboard's alone, and changing it signs every user out.

**Optional clean-up of unused secrets.** Older guides set secrets on the API
server that it never reads. List the API Worker's secrets (with `--env
production` when step 0.5 found that form):

```bash
cd cod-server && npx wrangler secret list [--env production]
```

If it shows `BETTER_AUTH_SECRET`, `MCP_REQUEST_STATE_KEY`,
`COOKIE_ENCRYPTION_KEY` or `API_KEY_SALT`, offer to delete them: the API
server reads none of them (the dashboard keeps its own `BETTER_AUTH_SECRET`).
Only on the developer's yes, one at a time, on the **API Worker only**:

```bash
npx wrangler secret delete <NAME> [--env production]   # Wrangler asks to confirm
```

Never delete a secret from the dashboard or the storefront. Optional features
(email, WhatsApp verification, Turnstile, Meta, Telegram) stay off until the
merchant turns them on in **Apps**.

## Step 5 — Apply the new migrations (before deploying)

```bash
cd cod-server
node scripts/d1.mjs migrations list --remote      # what is pending
npm run db:migrate:remote
node scripts/d1.mjs migrations list --remote      # nothing pending
```

- Migrations keep every row: they are written to run on a live store before
  its new code. Deploying first is what breaks a store (500s on missing
  columns); always migrate first.
- A release can ask for a step before its migration (`upgrading.mdx`): for
  example, the orders-and-shipments release's preflight query.
- **If a migration fails: stop.** No deploy, no retry, no hand edits to the
  database or `d1_migrations`. Report the error and the file name; the
  database backup from step 2 is safe.
- If the developer also runs the store locally: `npm run db:migrate:local`.
- Never run `db:seed:remote` or `seed:admin:remote` unless asked: the first
  gives the store the `STORE_API_KEY` it is passed, the second resets the
  admin's password.

## Step 6 — Redeploy, in order

Deploy what changed (step 1), **API server first**, then the dashboard, then
the storefront right after: a storefront must not run long against an API it
was not built for, nor the reverse.

```bash
cd cod-server && <API_DEPLOY>                 # from step 0.5
cd ../cod-client-astro && npm run deploy      # builds, then deploys
```

The storefront:

- **Cloudflare:** `cd ../cod-astro/theme-00 && ASTRO_KEY=<the store's ASTRO_KEY> npm run deploy`.
  The key is in the setup credentials file; without one, the deploy warns and
  pages already cached may need their cache to expire.
- **Vercel:** `cd ../cod-astro/theme-00 && npx vercel --prod`.

The dashboard's `npm run deploy` builds with the production `PUBLIC_API_URL`
and refuses a build that calls `localhost`; never upload a `dist/` built
another way. The storefront's deploy refuses a `localhost` `COD_SERVER_URL`.
A failed build means no deploy: report it and stop.

## Step 7 — Verify

| Check | Expected |
| --- | --- |
| `curl -s -o /dev/null -w "%{http_code}\n" https://<api-domain>/api/docs` | `200` |
| `curl -s -X POST https://<dashboard>/api/auth/sign-in/email -H "Content-Type: application/json" -H "Origin: https://<dashboard>" -d '{"email":"<admin>","password":"<password>"}'` | `200` and the user |
| The developer signs in to the dashboard | it loads, with the new version's screens |
| The storefront | the home page shows the store's products |
| A test order on the storefront | it appears in the dashboard |
| `node scripts/d1.mjs migrations list --remote` (in `cod-server`) | nothing pending |

Always send the `Origin` header. If the changelog named a fix or a feature,
try it once. While a check fails: `npx wrangler tail <worker-name> --format pretty`.

## Step 8 — Summary

Tell the developer:

1. The version: old commit (from `~/.wocart-update-old-head`) → new, the
   number of updates, and what changed for them (from `CHANGELOG.md`).
2. Migrations applied, and that none is pending.
3. Settings added to each file; names and domains unchanged.
4. Resources created and secrets set (names only, never values).
5. What was redeployed, and that every check passed.
6. The backup folder.

**Going back, if something is broken:**

- A Worker: `npx wrangler rollback` in its folder (with `--env production`
  for an API server deployed that way): the previous version, instantly.
- The code: `git checkout <old commit>`, then redeploy.
- The configuration: copy the files back from the backup folder.
- The database: migrations are never undone; the previous code keeps working
  on the newer database. Restoring the backup is a last resort, and only with
  the developer: it loses every order placed since.

## Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| `git merge --ff-only` refuses | The checkout has commits of its own | Let the developer decide; never force |
| Sign-in or a screen answers 500 after the update | Code deployed before its migration | Step 5, then redeploy the API |
| A new feature fails with "not set" or `MEDIA_NOT_CONFIGURED` | A setting or secret from step 4 is missing | Add it on the right Worker, redeploy |
| Deploy fails: a Workflow or queue already exists | A copied block kept the template's name | Name it after the store (step 3) |
| A second API Worker appeared (`…-production`, or without it) | The deploy form changed | Delete the new one only after confirming with the developer; keep the step 0.5 form |
| Sign-in `403 INVALID_ORIGIN` | The dashboard's address left `PUBLIC_TRUSTED_ORIGINS` | Put it back, `npm run deploy` in `cod-client-astro` |
| Signed in, every screen 401 | The API cannot check the dashboard's sign-in | `BETTER_AUTH_URL` (the dashboard's `/api/auth`) and `WORKER_SELF_URL` (the API's own address) in the API's config; redeploy it |
| Everyone was signed out | `BETTER_AUTH_SECRET` changed on the dashboard | Restore it from the setup credentials file |
| The dashboard calls `localhost` | A locally built `dist/` was uploaded | `npm run deploy` in `cod-client-astro` |
| The storefront shows an unavailable store | It cannot read the API | `COD_SERVER_URL` must be the API's domain, `STORE_API_KEY` unchanged; redeploy it |
| Local dev broken after the update | The local database is behind | `npm run db:migrate:local` in `cod-server` |
| A dev server dies with `Missing field 'moduleType'` | Two Vite versions | `rm -rf node_modules && npm ci` (root, and in `cod-astro/theme-00`) |
