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

**GET** returns the source fields (primary language) and every stored
translation, each flagged `outdated` when its source changed after it was
written:

```json
{ "resource": "product", "id": "p-1", "sourceLocale": "ar",
  "source": { "name": "هاتف", "description": "<p>…</p>" },
  "translations": { "fr": { "name": { "value": "Téléphone", "outdated": false } } } }
```

**PATCH** is a JSON Merge Patch (RFC 7396) of one language — a string sets a
field, `null` removes its translation:

```json
{ "locale": "fr", "values": { "name": "Téléphone", "description": null } }
```

Refused with 400: the primary language (edit the resource itself), a language
the store has not added, a field that is not translatable, an empty or
over-long value. `html` fields are sanitised exactly like their source.
Translating into an added but unpublished language is allowed — that is how a
store prepares a language before publishing it.

Storefront reads (`/store/config`, `/store/products`, `/store/products/{handle}`,
`/store/categories`, `/store/pages/{slug}`) take `?locale=` and answer with
`Content-Language`; see `cod-shared/stores/settings.ts` (`servedLocale`).
