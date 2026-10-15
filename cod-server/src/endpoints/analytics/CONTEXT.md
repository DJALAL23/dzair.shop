# Analytics Context

Ready-computed answers for dashboards: today the store's orders counted by
the stage the merchant sees, designed to grow one efficient read query at a
time.

## Language

### Metrics

**Order Stages**:
The one published metric set (`GET /analytics/order-stages`): orders counted by stage — their processing, then their shipment's delivery, the same stage as `GET /orders` — and how many need the merchant's attention. Powers the overview and the order list's queue counts.
_Avoid_: KPIs, reports, status breakdown

**Sparse Results**:
Only stages holding at least one order appear; a missing stage means zero, and filling the gaps (or summing stages into queues) is the caller's job.
_Avoid_: Zero-filled series

**Needs Attention**:
Orders whose delivery needs the merchant whatever their stage: a handoff the carrier never confirmed, a parcel the carrier cancelled, or one it flagged.
_Avoid_: Alerts, problems

**Single-Round-Trip Aggregation**:
Every metric is one grouped database query — no stitching rows together in application code.
_Avoid_: Multi-pass computation

**Who May Read**:
`dashboard:view` or `orders:read` — counting orders is reading them.

### Growth Rule

**Query Home**:
New reporting metrics belong as named functions beside this one in shared code (`cod-shared/queries/analytics.ts`) — each self-contained, read-only, and individually testable.
_Avoid_: Inline SQL in handlers, cross-module metric mixing

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Stages, statuses and their rules**: Orders (`cod-shared/orders/stage.ts`, `lifecycle.ts`) — this module counts, never judges or moves
- **Money metrics**: none here yet; settlement belongs to Payments
- **Product and stock health**: Products / Stock contexts own their own summaries

## Edge Cases

**Lifetime totals only**: no date range — counts span every order ever created.

**Deleted orders vanish**: a hard-deleted order leaves these counts with no trace.

**Zeros are absent**: a new store receives no stage rows and `needsAttention: 0`.
