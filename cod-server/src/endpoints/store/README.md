# Public Storefront API

The core public API used by the storefront (e.g., `cod-astro/theme01`). This API provides read access to products, categories, and settings, and handles checkout/review submissions.

## Structure

```
store/
├── routes.ts       # @hono/zod-openapi route definitions (validation + spec) with X-Store-API-Key auth
├── handlers.ts     # Handlers for storefront operations
├── queries.ts      # Re-exports shared queries from cod-shared/queries/store
├── validation.ts   # Zod schemas for order and review submission
├── *.test.ts       # Unit & integration tests
└── README.md       # This file
```

## Security Model

Unlike other `api/*` endpoints, this module uses a dedicated authentication header:
- **Header:** `X-Store-API-Key`
- **Scope:** Publicly accessible but requires a valid store key for context and logging.

## Core API Endpoints

### 1. Catalog & Config
- `GET /store/config`: Get public branding, theme, and SEO settings.
- `GET /store/products`: Paginated product catalog. Only returns products that are `ACTIVE`, `visibility=true` and `showInStore=true` — ordered featured-first, then newest.
- `GET /store/products/:handle`: Detailed product info fetched by URL slug (handle). Includes variants, images, and approved review stats.
- `GET /store/landing-pages/:slug`: Published landing page with its linked product in full store-product shape. Store-hidden products (`showInStore=false`) still render here — the landing page is their sales channel; only the catalog list and the product's own page stay hidden.
- `GET /store/categories`: List all categories in display order.

### 2. Location & Shipping
- `GET /store/shipping-rates`: Returns a per-wilaya shipping price map (Home & Stop-Desk).
- `GET /store/communes/:wilayaId`: List all communes for a specific wilaya for the checkout form.

### 3. Order & Checkout
- `POST /store/orders`: Create a public order.
    - **Side Effect:** Automatically finds or creates a customer profile by phone.
    - **Side Effect:** Resolves delivery fees based on the store's default shipping profile.
    - **Side Effect:** Automatically deducts inventory for tracked items.

### 4. Reviews & Feedback
- `GET /store/reviews?productId=...`: A product's **approved** reviews with their photos and voice note, and whether each is a verified purchase. Empty when the store turned reviews off.
- `POST /store/reviews/eligibility`: Proves a purchase with the order number **and the phone it was placed with**; answers the products the order may review (delivered, kept, each once) and, when the store takes media, an upload grant.
- `PUT /store/reviews/uploads`: One photo or voice note as the body, under the grant (`X-Review-Grant`).
- `POST /store/reviews`: Submits; answered at once, files prepared after (`visibility`: `published` or `after_review`, the store's choice). One review per product of an order. See `reviews/` here and `endpoints/reviews/CONTEXT.md`.

## Implementation Details

- **Automatic Customer Mapping:** If a customer places an order with a phone number already in the system, the order is automatically linked to their existing profile.
- **Inventory Protection:** The system automatically checks `trackInventory` status before deducting stock during checkout.
- **Review Integrity:** Shoppers identify themselves via the order number printed on their thank-you page; the server resolves it to the internal order and enforces one review per order.
- **SEO-First Routing:** Products are primarily fetched by `handle` rather than ID to support clean, human-readable URLs.
- **Aggregated Statistics:** Product responses include `avgRating` and `reviewCount` derived from the approved reviews database.
