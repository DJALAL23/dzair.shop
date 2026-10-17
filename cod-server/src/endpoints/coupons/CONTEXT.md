# Coupons Context

Codes a shopper enters at checkout for a discount the merchant set up. A coupon applies after offers, and never to a product an offer already applied to.

## Language

### Coupon Anatomy

**Coupon**:
A merchant-made discount a shopper claims by entering its Code at checkout. One coupon per order.
_Avoid_: Offer (an offer applies on its own, unasked), voucher, promo

**Code**:
What the shopper types: Latin letters, digits, `-` and `_`, 3 to 32 long, unique in the store. Matched without regard to case or spaces; Arabic-Indic digits read as 0–9.
_Avoid_: Coupon ID, key

**Coupon Kind**:
What a coupon gives: a Percentage Off, a Fixed Amount Off, or Free Delivery.

**Percentage Off**:
A share of what the Eligible Lines cost, optionally capped by a Most Off.
_Avoid_: Percent discount

**Most Off**:
The largest amount a Percentage Off may take from one order.
_Avoid_: Max discount, ceiling

**Fixed Amount Off**:
An amount taken once from the order's Eligible Lines, never more than they cost.
_Avoid_: Flat discount

**Free Delivery Coupon**:
A coupon whose benefit is the order's delivery fee dropping to zero.
_Avoid_: Shipping coupon

**Coupon Scope**:
What a coupon covers: the whole store, picked products, or the products of picked collections (as the collections stand when the order is placed).
_Avoid_: Target, applies-to list

**Eligible Lines**:
The paid lines of an order in the Coupon Scope that no offer applied to. A coupon's discount and its Minimum Requirement are measured on them alone.
_Avoid_: Discountable items

**Minimum Requirement**:
What the Eligible Lines must reach for the coupon to apply: an amount they cost together, offers applied, or a number of items — never both.
_Avoid_: Minimum order value (it is not the whole order)

**Audience**:
Who may use a coupon: everyone, or Selected Customers.

**Selected Customers**:
The picked customers and the members of the picked customer groups. A shopper is one of them when the order's phone belongs to one of those customers.
_Avoid_: Whitelist, allowed users

**Usage Limit**:
How many orders may use a coupon, across all customers.
_Avoid_: Quantity, stock

**One Use per Customer**:
A coupon a customer — known by their phone — may use on one order only.

**Schedule**:
Optional start and end. No start means live immediately; no end means it never expires; an end always comes after the start.

**Coupon Status**:
A manual `active` / `inactive` switch. Only an active coupon within its schedule is live.

### Application

**Redemption**:
A coupon's use by one order: the order records the coupon, its code as typed into the order, and the discount it gave. A Redemption counts toward the Usage Limit and One Use per Customer only while its order is not cancelled.
_Avoid_: Usage, claim

**Coupon Refusal**:
Why a code does not apply, as the shopper is told: unknown or switched off, outside its schedule, used up, already used by this customer, not for this customer (or waiting for the phone that decides it), nothing in the basket it covers, short of its minimum, or a free delivery with nothing to give. An order whose code is refused is refused whole.
_Avoid_: Invalid coupon (says nothing of why)

**Coupon Discount**:
What a coupon took off an order, shared across its Eligible Lines by what each costs, so every line still reads quantity × unit = total.
_Avoid_: Order-level discount (it is carried by the lines)

## Boundaries

- **Offers**: an offer applies first; a product an offer applied to is never an Eligible Line. Free delivery from an offer leaves a Free Delivery Coupon nothing to give.
- **Products and collections**: Products context; the scope is resolved to products when the order is placed.
- **Customers and groups**: Customers context; a customer is known by their phone.
- **Orders**: Orders context — the order's price is what its lines cost after the coupon, so the cash a carrier collects needs no knowledge of coupons.

## Edge Cases

**A coupon for products all under offers does not apply**: it has no Eligible Lines, so the shopper is told and the order is not discounted.

**A cancelled order gives its use back**: a fake or failed COD order does not burn a limited coupon.

**Two shoppers race for the last use**: the use is checked and recorded in the statement that places the order; only one order gets it.
