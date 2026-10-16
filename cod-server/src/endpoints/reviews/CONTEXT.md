# Reviews Context

What customers say about a product — in words, photos and a voice note — how it reaches the store, how the merchant decides what is public, and how every rating number on the storefront is recomputed from what survives here.

## Language

### Review Anatomy

**Review**:
A star rating and a few words about one product, from a Shopper Review or a Store Review, optionally with Review Media.
_Avoid_: Feedback, comment, testimonial

**Shopper Review**:
A review a shopper sends from the storefront, resting on their order — they have no account; the order is their proof of purchase.
_Avoid_: Customer submission, public review

**Store Review**:
A review the merchant enters from the dashboard for a customer — one received by WhatsApp, phone or in person — naming a customer from the list or a typed name, and optionally one of their orders.
_Avoid_: Fake review, manual review, imported review

**Rating**:
Whole stars, one through five.
_Avoid_: Score, points

**Review Media**:
The photos and the voice note attached to a review; they go with it.
_Avoid_: Attachments, files, uploads

**Voice Note**:
A short spoken review, recorded on the shopper's phone or sent as a file, at most one per review.
_Avoid_: Audio review, recording, podcast

**Verified Purchase**:
A review resting on an order that reached its customer, whoever entered it; decided once, when the review is entered. A Store Review without a delivered order is never verified.
_Avoid_: Confirmed buyer, trusted review

**Snapshot Attribution**:
The name and order number shown with a review are copied when it is entered and stay, whatever later happens to the customer.
_Avoid_: Live customer lookup

**Helpful Count**:
A display counter carried on every review, always zero — nothing increments it yet.
_Avoid_: Likes, votes

### Who May Write

**Proof of Purchase**:
A Shopper Review needs the order number and the phone the order was placed with; the number alone is guessable. A wrong number and a wrong phone get the same answer.
_Avoid_: Order verification, login

**Reviewable Product**:
A product of a delivered order that the shopper kept — not refused in full at the door, still in the catalog — and not yet reviewed from that order.
_Avoid_: Eligible item

**One Review per Product per Order**:
A basket's order can review each product it contained, each once.
_Avoid_: One review per order

### What the Merchant Decides

**Review Policy**:
The merchant's choices for their store: reviews on or off, what a shopper may attach (text only, photos, a voice note, and how many or how long), and Auto-Publish. Hard limits apply whatever they choose.
_Avoid_: Review settings (in code), configuration

**Auto-Publish**:
Which Shopper Reviews go public without the merchant checking them: none, text-only ones (anything with media waits), or all.
_Avoid_: Auto-approve, moderation off

### Moderation Lifecycle

**Processing**:
A Shopper Review received whose media is still being prepared; invisible to everyone until it lands as pending or approved.
_Avoid_: Uploading, draft

**Pending Queue**:
Reviews waiting for the merchant's decision; the list reports their global count for dashboard badges.
_Avoid_: Approval inbox, unmoderated pile

**Approval / Rejection**:
A merchant decision that flips a review's status; both are logged. No decision is final — a rejected review can be approved later and the other way round.
_Avoid_: Publishing, hiding

**Media Removal**:
Taking one photo or the voice note off a review — a face, a phone number — while the review stays.
_Avoid_: Censoring, editing the review

**Hard Deletion**:
Removing a review is permanent, its media files with it; the audit trail records the act.
_Avoid_: Archive, soft delete

### Visibility & Aggregation

**Approved-Only Display**:
The storefront shows only approved reviews and their media; anything else exists only behind merchant auth.
_Avoid_: Public preview

**Live Aggregates**:
Average rating and review counts are computed from approved reviews at every read; a moderation decision changes storefront numbers at once.
_Avoid_: Cached rating, periodic recalculation

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Delivered**: Shipments context — an order's shipment that reached its customer
- **Where aggregates appear**: Products and Store contexts embed average rating and count
- **Removal**: removing a product removes its reviews and their media; an order with a review was delivered, so it has a shipment and is never removed

## Edge Cases

**A basket, partly refused**: the products refused in full at the door cannot be reviewed; the ones kept can, each once.

**Removed product on an order**: an order line whose product left the catalog cannot be reviewed.

**Store Reviews never claim a purchase they cannot show**: without a delivered order of that customer, a Store Review shows no Verified Purchase badge, and it carries the date it was entered — never an earlier one.

**Media waits even when text does not**: under text-only Auto-Publish, a review with a photo or a voice note waits for the merchant, since media is where a face, a phone number or worse can appear.

**Badges ignore your filters**: the pending count travels with every list response whatever its filters.
