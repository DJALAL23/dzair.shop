# Analytics Context

Ready-computed answers for dashboards: the store's orders counted by the
stage the merchant sees, and the orders placed day by day — designed to grow
one efficient read query at a time.

## Language

### Metrics

**Order Stages**:
A published metric set (`GET /analytics/order-stages`): orders counted by stage — their processing, then their shipment's delivery, the same stage as `GET /orders` — and how many need the merchant's attention. Powers the overview and the order list's queue counts.
_Avoid_: KPIs, reports, status breakdown

**Order Activity**:
Orders placed per store day over the last 7, 30 or 90 days, today included (`GET /analytics/order-activity?days=`), each day's count and sales, and the totals of the same number of days just before for comparison. Powers the overview's trend.
_Avoid_: Revenue, traffic

**Store Day**:
A calendar day in Algeria, which keeps UTC+1 all year: a day starts at 23:00 UTC the evening before. Order activity buckets by it, never by the UTC date.
_Avoid_: UTC day, server day

**Sales**:
What placed orders are worth to the store — price plus delivery fee, the total the order list shows. Cancelled orders are left out; a placed order counts whether or not it was delivered yet.
_Avoid_: Revenue, collected cash

**Sparse Results**:
Only stages, or days, holding at least one order appear; a missing one means zero, and filling the gaps (or summing stages into queues) is the caller's job.
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
- **Money metrics**: only Sales, the value of placed orders; collected cash and settlement belong to Payments
- **Product and stock health**: Products / Stock contexts own their own summaries

## Edge Cases

**Stage counts are lifetime**: they take no date range — every order ever created. Only order activity is windowed.

**Deleted orders vanish**: a hard-deleted order leaves these counts with no trace.

**Zeros are absent**: a new store receives no stage rows and `needsAttention: 0`.
