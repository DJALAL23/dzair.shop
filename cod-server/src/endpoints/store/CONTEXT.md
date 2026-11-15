# Store Context

The public storefront surface under `/store/*`: everything a shopper touches without logging in — browsing the catalog, reading delivery rates, placing a COD order, and reviewing a purchase afterward.

## Language

### Access

**Store API Key**:
The single credential authenticating the entire storefront (`X-Store-API-Key`). A different secret from dashboard API keys; it determines which store's data every call sees.
_Avoid_: Admin key, session auth

### Catalog

**Storefront Catalog**:
The public product list. A product appears only with three green lights — ACTIVE status, visibility and show-in-store — ordered featured-first then newest. A removed product no longer exists; responses still carry `deletedAt: null` for `@wocart/storefront` releases that require the field.
_Avoid_: Full catalog, product dump

**Handle Lookup**:
Product details are fetched by URL handle, never by internal ID.
_Avoid_: Product ID lookup

### Checkout

**Store Order**:
A COD order submitted from the storefront for one product per submission, in any quantity, with optional per-unit variant picks.
_Avoid_: Cart order, multi-item order

**Find-or-Create Customer**:
Checkout looks up the customer by phone; an existing customer is reused exactly as-is, otherwise a new one is created from the checkout fields.
_Avoid_: Registration, sign-up

**Server-Authoritative Pricing**:
The unit price is resolved from the catalog at order time — the product's own price for simple products, each variant's price for variant orders. The client-sent unit price is accepted in the payload for display continuity but never trusted for money math. Totals, COD amounts, customer spend, and driver cash all derive from catalog prices.
_Avoid_: Client-supplied price, trusted unit price

**Variant Selections**:
One entry per ordered unit when different variants are mixed; identical units collapse into a single order line and stock deducts per variant.
_Avoid_: Variant array, options list

**Offer Selection**:
The shopper may pin an offer by ID; the server honors it only if it still qualifies — reached, and able to give its benefit — otherwise it picks the highest qualifying one.
_Avoid_: Coupon choice, discount code

**Buy X Get Y Reward**:
The free reward product of a promotion, appended to the order as a zero-price line. A reward the stock cannot cover makes its offer not qualify; the product falls to its next offer and the order still succeeds.
_Avoid_: Gift item, bonus product

**Coupon Code**:
A code the shopper enters at checkout (Coupons context). The cart quote says whether it applies and why not; an order whose code does not apply is refused, never silently placed without it.

**Free Shipping Offer**:
A promotion that zeroes the resolved delivery fee, reflected in both the fee line and the total.
_Avoid_: Shipping coupon

**SKU Gate**:
An order is refused unless the product — or every selected variant — carries a SKU. Missing SKUs block selling before stock is ever checked.
_Avoid_: Catalog requirement, setup warning

**Lead Mirror**:
A server-side Meta "Lead" event fired alongside each order — only when the merchant chose Lead as the Conversion Event — using the same event ID as the browser pixel, so Meta deduplicates instead of double-counting. Failure is logged and ignored — it can never block an order.
_Avoid_: Tracking pixel, analytics event

### Attribution

**Arrival**:
A page the shopper reached from outside the store: a typed address or a bookmark (`Sec-Fetch-Site: none`), another site or app (`cross-site`, `same-site`), or, without fetch metadata, a `Referer` that is not the store. A click inside the store or a prefetch is not an Arrival.
_Avoid_: Session start, landing

**Touch**:
What one Arrival carried: the touch parameters of its URL (one table, `cod-shared/attribution/signals.ts`: `utm_*`, `wc_*` and the platforms' click ids), the path it landed on and the other site (or Android app) that referred it. A direct Arrival has only its path. The storefront keeps four in a first-party cookie: the **First Touch**, the **Last Ad Touch**, the **Last Source** and **This Visit**.
_Avoid_: Session, hit, source

**Ad Click**:
A Touch an ad made: a parameter only an ad's URL carries (`ttclid`; Google's `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`; `msclkid`; Snapchat's `ScCid`; Wocart's ad template names `wc_cn`, `wc_an`), or a `utm_medium` matching Google Analytics' paid rule. A bare `fbclid` is not an Ad Click: Meta adds it to every link leaving Facebook and Instagram. Click ids are kept byte for byte, up to 1,000 characters.
_Avoid_: Click-through, conversion

**This Visit**:
The shopper's latest Arrival before ordering, an ad or not, a direct one included. A direct Arrival within 30 minutes of This Visit continues it.
_Avoid_: Session, last touch

**Last Source**:
The latest Arrival that was neither direct nor an Ad Click: a search engine, a social network, an email, an AI assistant, another site or a tagged link. A shopper who comes back by typing the address keeps it.
_Avoid_: Last non-direct click (that names the report model it follows)

**Ad Credited**:
The Ad Click an order credits: the latest one at most seven days (Meta's default click window) before the shopper submitted the order. None when no Ad Click is that recent.
_Avoid_: Attributed ad, conversion ad

**Channel**:
Where an order came from, as one word: the Ad Credited's (`paid_social`, `paid_search`, `paid_other`); else This Visit's when it came from somewhere; else the Last Source's, at most 30 days old; else This Visit's (`organic_social`, `organic_search`, `ai_assistant`, `email`, `referral`, `tagged`, `direct`); or the staff surface that entered it (`dashboard`, `api`, `agent`). A channel is paid only for the Ad Credited: an Ad Click too old to credit counts as what it is without the ad. Google Analytics' default channel group, plus Wocart's rules above. Null when nothing is known.
_Avoid_: Source label, medium

**Order Attribution**:
Where an order came from, one `order_attribution` row per order the storefront tracked or staff entered, written in the order's own batch: its Channel, the touch the Channel comes from (the Ad Credited, the Last Source or This Visit) in the touch columns, and This Visit in the `visit_*` columns. `_fbc` never decides it; it is only passed on to Meta. No row means nothing is known.
_Avoid_: Conversion source, UTM record

**Attribution Method**:
How an Order Attribution was made: `captured` from the shopper's visit, or `entered` for an order staff, the API or the AI agent created. Rows from before attribution v2 may say `merchant`, a source chosen by hand; they read as entered in the dashboard. Nobody names a source by hand any more.
_Avoid_: Attribution model (that is a report's choice of which touch to credit)

The touches come from a cookie the shopper holds, so the server trusts none of it (`cod-shared/attribution/touch.ts`): unknown keys are never read, each value is checked and capped, an id that is not digits never becomes `ad_id`, and an unreadable part is dropped without refusing the order. A basket order with no landing-page slug takes the landing page its visit landed on.

### Form Policy

**Checkout Form Policy**:
The merchant's per-store configuration of which order-form fields the storefront shows and how strictly each is enforced. No policy means today's form exactly.
_Avoid_: Form settings, field toggles

**Fixed Field**:
A field the merchant can never hide — name, phone, wilaya, commune — because COD dispatch, customer identity and delivery pricing depend on it.
_Avoid_: Locked field, mandatory field

**Custom Field**:
A merchant-authored question on the order form. Informational only: it never reaches carriers, pricing or basket normalisation.
_Avoid_: Extra field, metadata field

**Custom Field Answer**:
The shopper's reply stored on the order as a snapshot of id, label, type and value, so later edits to the policy never rewrite history.
_Avoid_: Custom field value

### Reviews

**Order Number Review**:
Review submission takes the customer-visible Order Number — the only identifier shoppers ever see — and resolves it internally; UUIDs stay hidden.
_Avoid_: Order ID review, account review

**One Review Per Order**:
Exactly one review per order, enforced against the internal order reference even though shoppers type the number.
_Avoid_: Duplicate check, rating cap

**Pending Moderation**:
Every submitted review starts unapproved; only merchant-approved reviews ever reach the public listing.
_Avoid_: Instant publish, auto-approve

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Abandoned checkouts**: captured by `abandoned-orders/` routes mounted under `/store` — visitors typing name + phone are recorded per browser session; a cron flips stale entries to abandoned after 30 minutes; placing the order marks them converted
- **Merchant store settings**: `stores/` folder owns configuration; `/store/config` merely reads it
- **Catalog truth, offers, review moderation**: products/, offers/, reviews/ contexts — the storefront renders, never governs
- **Delivery fee authority**: Shipping Profiles context — the storefront reads the default profile's rates only

## Edge Cases

**Prices are resolved server-side**: A forged client unit price changes nothing — the catalog row is the only price source for storefront orders. Dashboard-created orders (authenticated staff) may still set custom prices; that flexibility is a merchant feature, not a hole.

**Repeat buyers keep their record**: A returning phone reuses the stored customer untouched — the new checkout's name or wilaya never overwrites it.

**Rewards vanish quietly**: An out-of-stock Buy X Get Y reward disappears from the order without error or notice to the caller.

**Delivery availability is server-enforced**: A wilaya the default profile does not cover — or a delivery type the merchant disabled — cannot be ordered: the API refuses with DELIVERY_NOT_AVAILABLE instead of charging 0. Only a store with no shipping profile at all accepts orders at fee 0.

**Limits are capped twice**: Clients may ask for fewer results, but the server clamps page sizes regardless of what was requested.
