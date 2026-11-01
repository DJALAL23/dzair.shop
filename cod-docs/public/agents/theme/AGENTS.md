# Instructions for coding agents

This repository is a **Wocart storefront theme**: an Astro project on the
published `@wocart/theme` and `@wocart/storefront` packages. Merchants edit it
in Wocart Studio; shoppers order from it.

Before changing anything, read the skill:
`.agents/skills/wocart-theme/SKILL.md` (source:
https://docs.wocart.store/agents/wocart-theme/SKILL.md). The documentation is
https://docs.wocart.store/sdk/theme, indexed for agents at
https://docs.wocart.store/llms.txt; every page is also Markdown at its URL +
`.md`.

## Facts about this theme

| | |
| --- | --- |
| Theme key | `my-theme` — permanent; merchant edits are stored under it |
| Languages | `ar` (primary, RTL), `fr`, `en` |
| SDK versions | `@wocart/theme` 4.0.0, `@wocart/storefront` 3.0.0 (exact pins; platform v7) |
| The only store client | `src/theme/sdk.ts` |
| The only WhatsApp link | `src/theme/whatsapp.ts` (`whatsAppContact`) |
| Unreadable store | `src/theme/fallback.ts` (`unavailableStoreConfig`) |
| The catalog | `src/theme/theme.ts` |
| Text | `src/theme/content.ts` — every pack has the same keys |

Update this table when they change.

## Commands

```bash
npm run dev      # astro dev — needs COD_SERVER_URL and STORE_API_KEY in .env
npm run check    # astro check — must report 0 errors
npm test         # vitest — every test must pass
npm run build    # astro build — must complete
```

A change is done only when `check`, `test` and `build` pass. Quote their output.

## Rules

- Verify every import against `node_modules/@wocart/*/dist/*.d.ts`. No deep
  imports, no `@ts-ignore` over an SDK type.
- Never rename the theme key, a component `type`, a field `key`, or a shipped
  instance `id`.
- The theme never saves documents, settings or merchant text.
- No hardcoded shopper-facing text; every string in every language's pack.
- CSS logical properties only; images are media keys resolved with
  `config.media`; colours from color schemes.
- Platform links through `storefrontPath` and the store's `href`; the store's
  WhatsApp only through `src/theme/whatsapp.ts`; never a `wa.me` link.
- Every platform page type (twelve) is a surface with one required main
  section; product and landing surfaces guarantee an order form.
- No pack text states a fact about a store (delivery reach, hours, phone,
  address): those come from the store's data or a merchant's field.
- Browser scripts import only `@wocart/storefront`, `@wocart/theme/lifecycle`,
  `@wocart/theme/messages`, and `@wocart/theme/preview` on the preview route.
- Stop and report when the SDK lacks what you need. Do not work around it.
