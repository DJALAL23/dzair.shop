# Reviews Context — verification

Each term of [CONTEXT.md](./CONTEXT.md) against the code that makes it true,
and the test that proves it.

| Term | Where it holds | Proved by |
| --- | --- | --- |
| Review, Rating | `reviews` table, CHECK rating 1–5 (migration 0043) | `db/migration-0043-review-media.e2e.test.ts` |
| Shopper Review / Store Review | `reviews.source`; `lib/reviews/intake.ts`, `lib/reviews/store-review.ts` | `store/reviews/store-reviews.e2e.test.ts`, `reviews/reviews.e2e.test.ts` |
| Review Media, Voice Note | `review_media` (cascade), `workflows/review-media.ts`, `lib/review-media/prepare.ts` | `workflows/review-media.e2e.test.ts` |
| Verified Purchase | set once at entry: delivered order (`insertShopperReview`, `insertStoreReview`) | both e2e suites |
| Snapshot Attribution | `customer_name`, `order_number` copied at entry | migration test, e2e suites |
| Proof of Purchase | `findReviewableOrder` (number + `samePhone`), same answer for wrong number or phone | `store/store-reviews.eligibility.e2e.test.ts` |
| Reviewable Product | kept lines only, catalog product only, unique `(order_id, product_id)` | eligibility + migration tests |
| Review Policy, Auto-Publish | `cod-shared/reviews/policy.ts` (`reviewPolicy`, `statusOnArrival`) | `cod-shared/reviews/policy.test.ts` |
| Processing | status set at submit with files; landed by the media job or the hourly sweep | workflow e2e test |
| Pending Queue, Approval / Rejection | `getAllReviews` (pendingCount ignores filters), `updateReviewStatus` (never a processing review) | `reviews/reviews.e2e.test.ts` |
| Media Removal, Hard Deletion | `lib/reviews/removal.ts` — files after rows; product removal takes review files | `reviews/reviews.e2e.test.ts` |
| Approved-Only Display, Live Aggregates | `listApprovedReviews`; aggregates over approved rows | store e2e, `stock/list-count-e2e.test.ts` |
