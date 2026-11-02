---
name: wocart-theme
description: Build, change, review and upgrade Wocart storefront themes on the published @wocart/theme and @wocart/storefront SDKs (Astro). Use when creating a theme, adding or changing a section, its fields, page documents, settings, styles or preview, wiring checkout, translating a theme, or verifying that a theme actually works.
---

# Building Wocart themes

A Wocart theme is an Astro storefront on two published packages:

| Package | Owns |
| --- | --- |
| `@wocart/storefront` | Commerce: the store client (config, products, collections, menus, page data, shipping, cart, orders), request resolution and language routing, the place-order action, preview and revalidation tokens, browser-safe helpers (money, wilayas, communes, basket) |
| `@wocart/theme` | The editable layer: `defineComponent`/`defineTheme`, fields, JSON page documents, slots and blocks, style and color schemes, settings, content packs and plural messages, the manifest, the preview protocol, and the Astro renderer (`InstanceView`, `Blocks`, `Block`, `ThemeStyles`) |

Documentation: https://docs.wocart.store/sdk/theme (index for agents:
https://docs.wocart.store/llms.txt, every page also as Markdown at its URL +
`.md`). The installed packages' `.d.ts` files are the final authority.

## Versions

`@wocart/theme` 4.x with `@wocart/storefront` 3.x, which read platform v7.
Pin both exactly (`npm install --save-exact @wocart/theme@4.0.0
@wocart/storefront@3.0.0 zod`). A theme on `@wocart/storefront` 2.x reads a v7
store as unreadable.

## Rules: must and never

Each rule has a check. Run the checks; never assume a rule holds. The `grep`
checks assume the layout below; adapt the paths, not the rule.

### Must

| # | Must | Check |
| --- | --- | --- |
| 1 | Find every export you use in the installed declarations, and import only published entries: `@wocart/storefront`, `/server`, `/astro`, `/review-media`; `@wocart/theme`, `/astro`, `/astro/{InstanceView,Blocks,Block,ThemeStyles}.astro`, `/preview`, `/lifecycle`, `/messages`, `/image-service` | `grep -rnE "@wocart/[a-z-]+/(dist|src)/" src` prints nothing; `npx astro check` has 0 errors |
| 2 | Create the store client in **one** module, per request, with `theme: THEME_KEY` | `grep -rln "createStoreClient(" src` prints that one file |
| 3 | Fall back to `unavailableStoreConfig({ serverUrl, locale })` when the store cannot be read | `grep -rn "unavailableStoreConfig" src` finds it; no hand-written `StoreConfig` object exists |
| 4 | Compose **every** platform page type as a surface with one required main section: `home`, `catalog`, `category`, `collection`, `product`, `page`, `landing`, `checkout`, `thankYou`, `trackOrder`, `search`, `contact` | A test asserts the manifest's surfaces cover all twelve page types |
| 5 | Make each product and landing surface guarantee an order form (`role: "order-form"`, reached through the surface's `required` sections and their fixed or required blocks) | `validateThemeDefinition(theme)` is `[]` (else `order-form-not-guaranteed`) |
| 6 | Render saved documents through `resolveSurfaceDocument`, settings through `resolveThemeSettings` | Every `pageData.get(…)` result in `src` feeds `resolveSurfaceDocument` |
| 7 | Put every shopper-facing word in the content packs, the same keys in every language; counts through `formatMessage` plural keys (`key_one`, `key_few`, …) | `validateThemeDefinition(theme, { contentKeys })` and `pluralFormIssues(pack, locale)` are `[]` for every language |
| 8 | Build every platform link with `storefrontPath` and `localizeHref` (the request store's `href`); render a menu item's `href` as given | `grep -rnE '"/(products|category|collections|pages|lp|checkout|thank-you|track-order|search|contact)\b' src` prints only `url` field defaults (a merchant's editable link) and test fixtures |
| 9 | Reach the store's WhatsApp only through `whatsAppContact`, in one module holding the theme's words | `grep -rln "whatsAppContact(" src` prints that one file; `grep -rnE "wa\.me|config\.whatsapp" src` prints nothing |
| 10 | Take colours from color schemes (`colorScheme` fields, `schemeClass`, `--wc-color-*`); give a section that holds a form a `colorScheme` field | No hex colour in component CSS outside the theme's token file |
| 11 | Resolve images from media keys with `config.media` (`pictureOf`, `mediaImageUrl`, `mediaImageSrcset`, `mediaImageService`) | `grep -rnE "MEDIA_DOMAIN|cdn-cgi|imagekit\.io" src` prints nothing |
| 12 | Use CSS logical properties, and `dir`/`lang` from the request store | `grep -rnE "(margin|padding)-(left|right)" src` prints nothing you cannot justify |
| 13 | Bind browser behaviour with `bindEach` / `onEachPage` from `@wocart/theme/lifecycle` | `grep -rnE "astro:page-load|wocart:section-load" src` prints nothing |
| 14 | Build for both hosts from the same code: `@astrojs/cloudflare` by default, `@astrojs/vercel` when `DEPLOY_TARGET=vercel`, with `session: false` and the passthrough or media image service (never `sharp`); keep `wrangler.jsonc` with a `compatibility_date`, and pin `@cloudflare/vite-plugin` to 1.53.1 in `overrides` | `npm run build` writes `dist/server/wrangler.json` and `dist/client/wocart-theme.json`; `npm run build:vercel` writes `.vercel/output/static/wocart-theme.json`; `find .vercel/output -type l -o -name '*.dylib' -o -path '*darwin*'` prints nothing |
| 15 | Prove "done" with the verification commands below, and quote their output | You quote it |

### Never

| # | Never | Check |
| --- | --- | --- |
| 16 | Rename `defineTheme({ key })`, a component `type`, a field `key` or a shipped instance `id` that stores may have saved | `diffThemeManifests(previous, next).breaking` lists only what you intended |
| 17 | Write: no route saves a page document, settings or merchant text; Wocart Studio is the only writer | No `POST`/`PUT` route touches documents or settings |
| 18 | Write a fact about a store as a theme word: delivery reach ("58 wilayas"), hours, phone, address, prices, delivery times | Review every pack value: it must be true of every store |
| 19 | Import Zod, a schema, `@wocart/storefront/server` or `/astro`, or the root of `@wocart/theme` in browser code | Grep your browser scripts for `zod`, `Schema`, `@wocart/storefront/server`, `@wocart/storefront/astro` and `from "@wocart/theme"`: nothing |
| 20 | Compute a price, fee, discount or total in the browser, or re-implement checkout rules | Orders go through `placeOrderInput` / `executePlaceOrder`; quotes through `cart.validate` or `createQuoter` |
| 21 | Store a URL in an `image` field, CSS in a `style` field, or HTML anywhere; `set:html` a plain text field | `set:html` appears only with `richTextToHtml` output or a product's HTML description |
| 22 | Work around a missing API (deep import, copied SDK code, `@ts-ignore` over an SDK type) | Stop and report instead |

## The shape of a theme

```text
astro.config.mjs        output "server"; env schema: COD_SERVER_URL, STORE_API_KEY,
                        WOCART_PREVIEW_KEY — all server secrets, optional: true
src/middleware.ts       resolveStoreRequest (redirects, rewrite), preview, runFormAction
src/actions/index.ts    placeOrder = executePlaceOrder(placeOrderInput)
src/theme/key.ts        THEME_KEY, THEME_VERSION
src/theme/sdk.ts        getStoreClient(locale?) — the only createStoreClient call
src/theme/fallback.ts   unavailableStoreConfig({ serverUrl, locale })
src/theme/whatsapp.ts   storeWhatsApp(store, page) — the only whatsAppContact call
src/theme/store.ts      StoreContext: config, client, locale, fallbackLocales, isRTL,
                        content (pack + this language's overrides), routing, pathname, href
src/theme/content.ts    one pack per language
src/theme/theme.ts      defineTheme({ key, version, locales, content, surfaces, areas,
                        settings, style, preview, components })
src/theme/**/x.def.ts   defineComponent(...) beside X.astro
src/theme/documents/    *.page.json, *.area.json — shipped default documents
src/pages/              one route per platform page type: index, products/index,
                        products/[handle], category/[slug], collections/[handle],
                        pages/[slug], lp/[slug], checkout, thank-you, track-order,
                        search, contact, plus 404
src/theme/sections/Sections.astro   resolveSurfaceDocument → InstanceView, one read cache
src/pages/wocart-theme.json.ts      themeManifestEndpoint (prerender)
src/pages/wocart-styles.css.ts      themeStylesEndpoint (prerender)
src/pages/wocart-preview.astro      previewTarget + previewResponseHeaders + bridge
src/pages/wocart-revalidate.ts      readRevalidateRequest → drop cached pages
```

The full, verified version of every file is at
https://docs.wocart.store/sdk/theme/build and
https://docs.wocart.store/sdk/theme/tutorial. Start from it; do not invent a
different wiring.

## Workflows

### A. Start a new theme

1. Read https://docs.wocart.store/sdk/theme/build.md and tutorial.md.
2. Create the project exactly as the quick start does, with exact pins
   (`npm install --save-exact @wocart/theme@4.0.0 @wocart/storefront@3.0.0`),
   both adapters and the `astro.config.mjs` that picks one by `DEPLOY_TARGET`
   (rule 14).
3. Decide before coding: the theme key (permanent), the languages, one
   surface per platform page type (all twelve, rule 4) with its main section,
   the areas (`header`, `footer`) and which surfaces may hide them, the
   settings, and the theme's words for the store's WhatsApp.
4. Build one surface end to end — definition → component → default document →
   route → contract test — and run the checks before adding the next.
5. Add the product and landing surfaces with their guaranteed order form,
   the other page types, then preview and revalidation. Finish with the
   production checklist
   (https://docs.wocart.store/sdk/theme/production.md).

### B. Add or change a section

1. Find its definition (`*.def.ts`), its component, its entries in the default
   documents, and its tests.
2. Classify the change before editing:

| Change | Kind | Do |
| --- | --- | --- |
| Add a field | additive | definition + component prop (`InferProps`) + a `default` or `contentKey` + the key in every pack + test |
| Change a default | additive | definition; check it against the field's rules |
| Rename a field key | **breaking** | don't; add the new key, keep reading the old one |
| Rename a component type | **breaking** (`unknown-type`) | don't; add a new type |
| Narrow a slot's `allow`, a range, options, a list `max`; remove a field, option, content key, surface, area or component | **breaking** for saved pages | only with a major version |
| Add a surface or area | additive | spec + default document + route + manifest |
| Add a setting | additive | declaration + `resolveThemeSettings` reader + a component that uses it |

3. Edit documents only through the document operations (`insertInstance`,
   `moveInstance`, `duplicateInstance(theme, page, id, newId)`,
   `setInstanceProps`, `setInstanceHidden(theme, …)`,
   `removeInstance(theme, …)`), then `checkPageData(theme, page)` must be `[]`.
4. Run the checks.

### C. Make a hardcoded design editable

1. List every value a merchant should change: text → `text`/`textarea` with a
   `contentKey`; images → `image`; counts → `number` with `min`/`max`; choices
   → `select` with `options` and `optionLabels`; products → `product`,
   `productList` or `collection`; repeated items → `list`; spacing → `style`;
   colors → `colorScheme`.
2. Move every string into the packs, in every language.
3. Declare the definition, type the component with `InferProps<typeof def>`,
   and read data in `load` through `reads.get(key, …)`.
4. Add the section to a default document; run the checks; render it in every
   language and in RTL.

### D. Review a theme change

Answer each with evidence (file and line, or command output):

1. Does every new import exist in the installed packages' declarations?
2. Is every new field consumed by its component, with a default or pack text?
3. Do `validateThemeDefinition(theme)` and every default document's
   `validatePageData(...).issues` return `[]` in every declared language?
4. Does the page render with no unexpected `onIssue`?
5. Are all strings in packs, all internal links localized, all images media
   keys with alt text, all CSS logical?
6. Is any page type rendered without a surface, any store fact written as a
   theme word, any `wa.me` link or platform path written by hand?
7. Do empty, failed and missing data render sensibly, and does an unreadable
   store render the unavailable store?
8. Did `astro check`, the tests and the build pass?
9. Does `diffThemeManifests(previous, next).breaking` list only intended
   changes?

### E. Upgrade the SDKs

1. Read both packages' `CHANGELOG.md` for every version crossed.
2. Bump both exact pins together; the storefront version must satisfy
   `@wocart/theme`'s peer range.
3. Run the checks; fix every new `validateThemeDefinition` issue.
4. Compare manifests with `diffThemeManifests`; render every surface in every
   language.

## Verification (run all, quote the results)

```bash
npx astro check        # 0 errors
npx vitest run         # every test passes
npm run build          # Cloudflare: dist/server/wrangler.json and dist/client/wocart-theme.json exist
npm run build:vercel   # Vercel: .vercel/output/static/wocart-theme.json exists
```

The contract tests every theme keeps:

```ts
expect(validateThemeDefinition(theme)).toEqual([]);
const checked = validateThemeManifest(JSON.parse(JSON.stringify(themeManifest(theme))));
expect(checked.issues).toEqual([]);
for (const locale of theme.locales) for (const document of shippedDocuments)
  expect(validatePageData(theme, document, { content: content[locale], locales: [locale] }).issues).toEqual([]);
for (const locale of theme.locales) expect(pluralFormIssues(content[locale], locale)).toEqual([]);
```

With a store available (`COD_SERVER_URL`, `STORE_API_KEY` in `.dev.vars`), also run
`npm run dev` and check: `/` and every published `/<lang>` render with the
right `lang`/`dir`; a product page renders; `/products/<unknown>` is a 404; the
order form re-renders a refused order with its error and redirects a placed
one to the thank-you page; `/contact` shows only what the store has set; with
a wrong `STORE_API_KEY` every page renders the unavailable store instead of
failing.

## Decoding problems

Every issue code, its meaning and its fix:
https://docs.wocart.store/sdk/theme/troubleshooting.md. Reading degrades and
reports (`PageDataIssue`); writing refuses (`DocumentIssue`); assembly lists
everything (`ThemeDefinitionIssue`).

## Stop and report instead of proceeding when

- the API you need is not in the installed declarations;
- the only way forward is a deep import, copying SDK code into the theme, a
  `@ts-ignore`, or a cast that hides a type error from the SDK;
- a change would rename a theme key, a component type, a field key or a
  shipped instance id;
- a check fails and fixing it would mean changing the SDK itself;
- you cannot run the verification commands — say so; never claim success.
