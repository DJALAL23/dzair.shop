# Contributing to Wocart

Thanks for helping. Wocart is an open-source cash-on-delivery store platform
for Algeria, running on Cloudflare (Workers, D1, R2, KV).

## The repository

| Folder | What it is |
| --- | --- |
| `cod-server/` | The API: Hono on Workers, D1 through Drizzle |
| `cod-client-astro/` | The merchant dashboard: Astro with React islands |
| `cod-shared/` | Schema, queries, permission scopes and error codes, shared by source |
| `cod-astro/theme-00/` | The reference storefront theme, built on the `@wocart/*` SDKs from npm |
| `cod-docs/` | The developer site, [docs.wocart.store](https://docs.wocart.store) |

`cod-server`, `cod-client-astro` and `cod-shared` are npm workspaces with one
root lockfile. Theme-00 and `cod-docs` have their own lockfiles.

## Get it running

Requires Node 24 (see `.nvmrc`). Follow
[Local setup](https://docs.wocart.store/self-hosting/local) step by step. In
short:

1. `npm ci` at the root.
2. In `cod-server` and `cod-client-astro`, copy `wrangler.toml.example` and
   `.dev.vars.example` and fill them in, as the guide explains.
3. `cd cod-server && npm run db:setup:local && npm run dev` starts the API on
   `:8787`.
4. `cd cod-client-astro && npm run seed:admin && npm run dev` starts the
   dashboard on `:4321`. Sign-up is off by design: `seed:admin` creates your
   admin account and prints its password.

## Your first change

1. Pick an issue labeled `good first issue`, or open one before larger work.
2. Keep the PR small and about one thing.
3. Run the checks for what you touched:

   | Package | Checks |
   | --- | --- |
   | `cod-server`, `cod-client-astro` | `npm run typecheck && npm test` |
   | `cod-astro/theme-00` | `npm ci && npm test && npx astro check` |
   | `cod-docs` | `npm ci && npm run typecheck && npm run check:i18n` |

4. Open the PR with the template and write `Closes #N`. CI must be green.

## Rules that matter

- **No secrets.** Keys go in `.dev.vars` or `wrangler secret put`, never in
  source, tests or a committed `wrangler.toml` (only the `.example` files are
  tracked). No real customer data in fixtures.
- **One source of truth.** Schema, queries, scopes and error codes live in
  `cod-shared`; never copy them into an app.
- **Migrations never lose data.** Add a new migration, never edit a released
  one. See the migration rules in [AGENTS.md](./AGENTS.md).
- **The dashboard talks to the API only** through `src/lib/api.ts`.
- **Every UI string in three languages:** Arabic, French and English, with RTL
  working.
- **Theme-00 holds no platform logic.** It uses the SDKs' public entry points;
  rules belong in `@wocart/storefront`.
- **Docs match the code.** Never describe a feature that doesn't exist yet.

[AGENTS.md](./AGENTS.md) has the full list of conventions and known traps.
Coding agents should read it first.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org):
`feat(orders): …`, `fix(shipping): …`, `docs: …`, `chore(deps): …`.

## Help and security

- Questions and bugs: [open an issue](https://github.com/bighadj22/Wocart/issues).
- Security problems: report them privately, as [SECURITY.md](./SECURITY.md)
  explains.

By contributing, you agree your work is licensed under the
[Apache License 2.0](./LICENSE).
