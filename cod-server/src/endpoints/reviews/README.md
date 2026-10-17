# Product Reviews — the merchant's side

Moderate what shoppers send, take a photo or the voice note off a review,
delete a review, and enter a review a customer gave the store (WhatsApp,
phone, in person). The storefront's side — finding an order, sending files,
submitting — is `endpoints/store/reviews/`; the rules both follow are
`cod-shared/reviews/` and the words are in [CONTEXT.md](./CONTEXT.md).

## Structure

```
reviews/
├── routes.ts        # defineRoute() definitions, RBAC, OpenAPI
├── handlers.ts      # thin: parse, call, log activity, present media URLs
├── validation.ts    # list filters, decisions, store reviews
├── ai-tools.ts      # MCP: list, moderate, delete (no tool enters reviews)
└── reviews.e2e.test.ts  # real D1 + local R2, through the routes
```

The work behind the handlers:

- `lib/reviews/removal.ts` — delete a review or one file: rows first, R2 files after the commit.
- `lib/reviews/store-review.ts` — a review the store enters, and its uploads.
- `lib/review-media/` — receiving a file, the media job's steps, URLs.
- `workflows/review-media.ts` — prepares photos (WebP 1600 + 480, EXIF gone) and voice notes after a review is in.

## Endpoints (`/api/reviews`)

| Method | Path | Scope | What |
| --- | --- | --- | --- |
| GET | `/` | `reviews:read` | Reviews newest first with their media; filters `status`, `productId`, `source` (`storefront`/`merchant`), `withMedia`; `pendingCount` ignores filters. A review still `processing` is not listed. |
| GET | `/{id}` | `reviews:read` | One review. |
| PATCH | `/{id}` | `reviews:manage` | `approved`, `rejected` or back to `pending`; logged. |
| DELETE | `/{id}` | `reviews:manage` | Deletes it and its files. |
| DELETE | `/{id}/media/{mediaId}` | `reviews:manage` | Takes one photo or the voice note off; the review stays. |
| POST | `/` | `reviews:create` | Enters a review: product, customer (or a typed name), optional order of that customer that brought the product (a delivered one makes it verified), rating, text, uploads, publish now or not. |
| POST | `/uploads` | `reviews:create` | One photo or voice note (≤ 120 s) as the body, for a review being entered. |
| GET | `/order-options` | `reviews:create` | A customer's orders that brought a product, delivered or not, reviewed or not. |

The store's choices — photos per review, voice note length, what publishes
without checking — are saved with the store settings (`PATCH /api/stores/me`:
`reviewMaxPhotos`, `reviewVoiceMaxSeconds`, `reviewAutoPublish`).
