# Translations

Translations of merchant data into the store's other languages (ADR 0005,
phase C). The registry of what can be translated is
`cod-shared/i18n/translations.ts` (`TRANSLATABLE`); rows live in the
`translations` table (migration 0037).

`registerTranslationRoutes` mounts the same two routes on each resource's own
router, guarded by that router's scopes:

| Resource | Route | Read scope | Write scope |
|---|---|---|---|
| product | `/api/products/{id}/translations` | `products:read` | `products:update` |
| category | `/api/product-groups/{id}/translations` | `product_groups:read` | `product_groups:manage` |
| offer | `/api/offers/{id}/translations` | `offers:read` | `offers:manage` |
| store | `/api/stores/me/translations` | admin | admin |
| menuItem | `/api/menus/items/{id}/translations` | `navigation:read` | `navigation:manage` |
| collection | `/api/collections/{id}/translations` | `collections:read` | `collections:manage` |
| whatsappWidget | `/api/apps/whatsapp-button/translations` | `whatsapp-button:read` | `whatsapp-button:manage` |

**GET** returns the source fields (primary language), the languages it can be
translated into (`targetLocales`: every added language but the primary, so an
editor without access to store settings still knows them), and every stored
translation, each flagged `outdated` when its source changed after it was
written:

```json
{ "resource": "product", "id": "p-1", "sourceLocale": "ar",
  "targetLocales": [{ "locale": "fr", "published": true }],
  "source": { "name": "هاتف", "description": "<p>…</p>" },
  "translations": { "fr": { "name": { "value": "Téléphone", "outdated": false } } } }
```

**PATCH** is a JSON Merge Patch (RFC 7396) of one language — a string sets a
field, `null` removes its translation:

```json
{ "locale": "fr", "values": { "name": "Téléphone", "description": null } }
```

Refused with 400: the primary language (edit the resource itself), a language
the store has not added, a field that is not translatable, a field the source
leaves empty (there is nothing to translate), an empty or over-long value.
`html` fields are sanitised exactly like their source. A storefront read shows
a translation only over a source text: a field emptied in the primary language
is empty in every language.

The WhatsApp button's texts are read differently on the storefront: a text with
no translation in the served language is `null`, the theme's own words, never
the primary language's (`resolveStorefrontWidget`). Emptying a text, or saving
the button back to nothing, deletes its translations.
Translating into an added but unpublished language is allowed — that is how a
store prepares a language before publishing it.

A product's variant options are translated on the product too, keyed by
their source text — `option:["اللون"]` for an option's name,
`option:["اللون","أحمر"]` for one of its values. GET lists them in `options`
(each with its key), so an editor never builds a key itself. PATCH refuses an
option the product does not have, and a translation that would make two
options, or two values of one option, read the same in that language. When
the product's options change, the keys it no longer has are deleted in every
language.

Storefront reads (`/store/config`, `/store/products`, `/store/products/{handle}`,
`/store/categories`, `/store/pages/{slug}`, `POST /store/cart/validate`) take `?locale=` and answer with
`Content-Language`; see `cod-shared/stores/settings.ts` (`servedLocale`).
