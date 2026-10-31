# CodFlow Server - Context Map

CodFlow is a cash-on-delivery (COD) e-commerce platform for Algeria. Multiple bounded contexts handle different aspects of the business.

## Contexts

Convention: one `CONTEXT.md` per endpoint folder; cross-folder terms live in the owning context below.

| Status | Context | File | Scope |
|--------|---------|------|-------|
| ✅ written | Orders | [./src/endpoints/orders/CONTEXT.md](./src/endpoints/orders/CONTEXT.md) | Order processing (lifecycle), the stage the merchant sees, COD workflow |
| ✅ written | Delivery | [./src/endpoints/delivery-companies/CONTEXT.md](./src/endpoints/delivery-companies/CONTEXT.md) | Carrier companies: provider and settings, capabilities, webhook and pull updates, the inbox, stop desks |
| ✅ written | Shipments | [./src/endpoints/shipments/CONTEXT.md](./src/endpoints/shipments/CONTEXT.md) | An order's delivery: handoff to a carrier or a driver, history, milestones, the actions open now |
| ✅ written | Products | [./src/endpoints/products/CONTEXT.md](./src/endpoints/products/CONTEXT.md) | Product catalog, variants, inventory counting, lifecycle & storefront exposure |
| ✅ written | Customers | [./src/endpoints/customers/CONTEXT.md](./src/endpoints/customers/CONTEXT.md) | Customer identity by phone, purchase ledger, groups & tags memberships |
| ✅ written | Payments | [./src/endpoints/driver-payments/CONTEXT.md](./src/endpoints/driver-payments/CONTEXT.md) | Settling drivers' delivered shipments (cash, fees), payment lines, driver ledger |
| ✅ written | Drivers | [./src/endpoints/drivers/CONTEXT.md](./src/endpoints/drivers/CONTEXT.md) | In-house workforce: identity, availability, per-wilaya pay grid, deletion guards |
| ✅ written | Shipping Profiles | [./src/endpoints/shipping-profiles/CONTEXT.md](./src/endpoints/shipping-profiles/CONTEXT.md) | Customer delivery pricing: rate cards, commune overrides, fee resolution |
| ✅ written | Wilayas | [./src/endpoints/wilayas/CONTEXT.md](./src/endpoints/wilayas/CONTEXT.md) | Algeria's 58 wilayas + communes as read-only reference geography (IDs, postal codes, bilingual names) |
| ✅ written | Offers | [./src/endpoints/offers/CONTEXT.md](./src/endpoints/offers/CONTEXT.md) | Automatic promotions: Buy X Get Y, free delivery, quantity pricing; one offer per product |
| ✅ written | Coupons | [./src/endpoints/coupons/CONTEXT.md](./src/endpoints/coupons/CONTEXT.md) | Shopper-entered codes: kinds, scope, audience, usage limits, redemptions; applied after offers |
| ✅ written | Reviews | [./src/endpoints/reviews/CONTEXT.md](./src/endpoints/reviews/CONTEXT.md) | Moderation of order-anchored product reviews; live rating aggregates |
| ✅ written | Stock | [./src/endpoints/stock/CONTEXT.md](./src/endpoints/stock/CONTEXT.md) | Inventory ledger: movements, manual adjustments, health alerts & valuation |
| ✅ written | Variants | [./src/endpoints/variants/CONTEXT.md](./src/endpoints/variants/CONTEXT.md) | Sellable combinations of variable products: pricing, SKUs, deletion semantics (routes mounted via products/) |
| ✅ written | Analytics | [./src/endpoints/analytics/CONTEXT.md](./src/endpoints/analytics/CONTEXT.md) | Dashboard metrics: orders by stage and needing attention (read-only) |
| ✅ written | Abandoned Orders | [./src/endpoints/abandoned-orders/CONTEXT.md](./src/endpoints/abandoned-orders/CONTEXT.md) | Captured half-finished checkouts: session capture, 30-min sweep, recovery stats (storefront + dashboard surfaces) |
| ✅ written | Media | [../cod-shared/media/CONTEXT.md](../cod-shared/media/CONTEXT.md) | Images and voice notes kept by key on the store's host (ImageKit or R2): upload tickets, confirmation, references, the sweep |
| ✅ written | Activity Logs | [./src/endpoints/activity-logs/CONTEXT.md](./src/endpoints/activity-logs/CONTEXT.md) | Admin-only audit trail: who did what across every context (fire-and-forget writes) |
| ✅ written | MCP | [./src/endpoints/mcp/CONTEXT.md](./src/endpoints/mcp/CONTEXT.md) | AI-agent surface: OAuth-verified tool sessions, scope-gated registry, HITL confirmations, connection revocation |
| ✅ written | Store Settings | [./src/endpoints/stores/CONTEXT.md](./src/endpoints/stores/CONTEXT.md) | Merchant configuration: branding, theme, localization, SEO, Meta pixel (single-tenant, admin-only) |
| ✅ written | Customer Tags | [./src/endpoints/customer-tags/CONTEXT.md](./src/endpoints/customer-tags/CONTEXT.md) | Free-form customer labels: unique names, idempotent assignments, count-guarded deletion |
| ✅ written | Customer Groups | [./src/endpoints/customer-groups/CONTEXT.md](./src/endpoints/customer-groups/CONTEXT.md) | Curated customer segments: descriptions, membership counts, count-guarded deletion |
| ✅ written | Product Groups | [./src/endpoints/product-groups/CONTEXT.md](./src/endpoints/product-groups/CONTEXT.md) | Category tree for products: nesting, slugs, SEO fields, live product counts (routes call it "categories") |
| ✅ written | Users | [./src/endpoints/users/CONTEXT.md](./src/endpoints/users/CONTEXT.md) | Team management: roles, scope grants/revokes, one-time API keys (admin-role gated) |
| ✅ written | Store | [./src/endpoints/store/CONTEXT.md](./src/endpoints/store/CONTEXT.md) | Public storefront: catalog, shipping rates, COD checkout, reviews (X-Store-API-Key auth) |
| ✅ written | Events | [./src/endpoints/events/CONTEXT.md](./src/endpoints/events/CONTEXT.md) | Business Events: the catalogue, the Event Log, Consumers (webhooks, chats, customers, Meta) and their Deliveries |

All endpoint folders are now documented — no candidates remain. Future folders follow the same convention: one CONTEXT.md per folder, registered here with a ✅ row.
## Relationships

- **Orders → Shipments**: A ready order is handed to a carrier or to the store's driver; its delivery is then its shipment
- **Shipments → Delivery**: A carrier shipment calls its company's adapter; webhooks and pulls report back into the shipment's history
- **Shipments → Orders, Products, Customers**: Milestones have effects — a return restocks the order, a delivery counts toward the customer's spend
- **Shipments → Drivers**: A driver shipment freezes the driver's fee; its delivery credits the driver's ledger
- **Drivers → Payments**: Settlements settle delivered shipments, each part (cash, fee) once; a driver who delivered is set inactive, never deleted
- **Orders → Products**: Orders contain product lines; inventory is decremented on order creation
- **Orders → Customers**: Each order belongs to a customer; auto-creates customer if not found
- **Offers → Coupons**: Offers price the basket first; a coupon covers only the lines no offer applied to
- **Coupons → Orders**: A coupon's discount is carried by the order's lines; a cancelled order gives its use back
- **Store → Orders**: Public storefront creates orders; abandoned carts become abandoned orders
- **Orders, Shipments → Events**: Every change to an order or shipment records its Business Event with the change; Events delivers it to the Consumers that asked for it
- **Events → Store Settings**: Meta conversions are a Consumer, configured by the store's pixel settings

## Shared Concepts

- **Wilaya/Commune**: Algerian administrative divisions (58 wilayas, ~1500 communes)
- **COD Amount**: Total to collect = product price + delivery fee
- **Store**: One store per deployment — each merchant's store has its own Worker and its own D1, so its data is isolated by deployment, not by a `store_id` on every row
