# cod-docs

The developer site: the platform API reference (OpenAPI) plus the guides for
`@wocart/storefront` and `@wocart/theme`. Built with [Zudoku](https://zudoku.dev/)
and published as a static site with three languages.

## Commands

```sh
npm ci                 # this folder has its own lockfile (it is not a root workspace)
npm run dev            # zudoku dev on :3000
npm run typecheck      # tsc over src/ and zudoku.config.tsx
npm run check:i18n     # English/French/Arabic parity and navigation integrity
npm run build          # generates artifacts, builds, then localizes the HTML
npm run generate       # only the generated artifacts
```

`build` and `generate` run `scripts/generate.mjs`, which needs a live API:

- `COD_OPENAPI_URL` (default `http://localhost:8787/api/openapi.json`) is
  fetched and shaped into `openapi.json`.
- TypeDoc is run over the installed `.d.ts` entry points of `@wocart/storefront`
  and `@wocart/theme`, writing `pages/sdk/*/reference/`.

So a docs build requires `cod-server` running locally (or `COD_DOCS_ENV=production`
plus a reachable `COD_OPENAPI_URL`). To build docs without the server, serve a
saved spec from any origin and point `COD_OPENAPI_URL` at it.

Generated artifacts are gitignored: `openapi.json` and `pages/sdk/*/reference/`.

## The three languages

| Language | Location |
| --- | --- |
| English (source) | `pages/<slug>.mdx` |
| French | `pages/fr/<slug>.mdx` |
| Arabic | `pages/ar/<slug>.mdx` |

The file path after `pages/` mirrors the URL after the locale prefix. English has
no prefix; `/fr/sdk/theme/api` is `pages/fr/sdk/theme/api.mdx`.

Rules:

- Every guide page exists in all three languages, with the **same headings in the
  same order**. `npm run check:i18n` enforces it.
- Code, identifiers, package names and commands are never translated.
- A new page must be added to `src/i18n/navigation.ts` with `en`, `fr` and `ar`
  labels, in the right group, or the other locales' sidebars break.
- The generated API reference (`pages/sdk/*/reference/`) is English only and is
  linked from all three locales by the navigation's reference link.
- `architecture.mdx`, `self-hosting/` and `features/` are English only until
  their French and Arabic translations. So are the SDK guides
  (`sdk/storefront/`, `sdk/theme/`, listed in `englishOnlySections`): they
  were rewritten around the starter in English first, and have no French or
  Arabic pages until they are translated again. They are listed in `englishOnlyGroups`
  in `src/i18n/navigation.ts`: the French and Arabic sidebars link to the
  English pages, marked as English, and `check:i18n` exempts them from parity.

Translation tone: natural technical French; Arabic written for Algerian
developers, with API names kept in English where that is clearer.

## Layout

```text
pages/               MDX sources, English + fr/ + ar/
  sdk/storefront/    storefront SDK guide
  sdk/theme/         theme SDK guide
  architecture.mdx   how the platform fits together
  self-hosting/      run, configure, deploy and upgrade a store
  features/          one page per store feature
src/
  Home.tsx           localized landing page (en/fr/ar copy)
  i18n/navigation.ts the slug registry and localized sidebar labels
  i18n/plugin.ts     Zudoku navigation plugin
  i18n/LocaleSwitcher.tsx
scripts/
  generate.mjs       OpenAPI shaping + TypeDoc reference generation
  check-i18n.mjs     localisation and navigation check
  localize-html.mjs  sets lang/dir on the built fr/ and ar/ HTML
zudoku.config.tsx    site config: nav, API reference, search, llms.txt
```

## Verifying a documentation change

```sh
npm run typecheck
npm run check:i18n
npm run build
```

`check:i18n` fails on: an English page without `fr`/`ar`, a heading-count
mismatch, a navigation slug with no file, a page missing from navigation, or an
empty page. `build` fails on invalid MDX, a broken manifest endpoint, or a
TypeDoc error in the published declarations.

Link targets are not checked automatically: when you rename a page, grep for its
old slug in `pages/` and `src/i18n/navigation.ts`.

## Keeping the docs true

- The SDK sources and tests are the contract; a page may not describe behavior
  they do not implement.
- A contract change ships with its pages and its examples.
- The theme guide is written around the theme starter
  (`create-wocart-theme`): its files are the examples, and the agent skills a
  theme ships live in the starter, never here. Theme-00 is not a reference.
- The docs never carry instructions for AI agents.
