# Offers CONTEXT.md Verification Report

**Date:** October 17, 2026
**Status:** ✅ VERIFIED AGAINST CODE

Each term in CONTEXT.md, and where the code makes it true:

| Term | Code | Proven by |
|------|------|-----------|
| Offer kinds, Price Tier, coherence | `cod-shared/offers/model.ts` (`OFFER_KINDS`, `tierFor`, `tieredTotal`, `offerProblem`); migration `0051` CHECKs | `cod-shared/offers/engine.test.ts`, `offers.e2e.test.ts` |
| Counted Units, One Offer per Product, Reward once per order, Free Delivery for one product | `cod-shared/offers/engine.ts` (`applyOffers`) | `engine.test.ts` (rules + properties) |
| Quantity Pricing never live beside another offer | `cod-shared/queries/offers.ts` (`writeProblem`) | `offers.e2e.test.ts` |
| One pricing path for quote and order | `cod-shared/queries/catalog-snapshot.ts` (`priceCartLines`), `cod-shared/queries/store.ts` (`createStoreOrder`), `store/handlers.ts` (`validateCart`) | `store/quantity-pricing-orders-e2e.test.ts` |
| Reward Left Out (stock counted with paid units) | `createStoreOrder` gift lines | `quantity-pricing-orders-e2e.test.ts` |
| Order lines record offer / reward | `order_products.offer_id`, `reward`; `orders.delivery_offer_id` (migration 0051) | `quantity-pricing-orders-e2e.test.ts`, `offers.e2e.test.ts` |

The rule changes against the earlier code (a locked variant counting alone, an offer that changed nothing not being reported, a reward's stock counted with the paid units, the default reward variant chosen by position) are deliberate fixes, each pinned by a test that fails with the old behaviour.
