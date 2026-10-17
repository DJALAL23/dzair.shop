# Offers Context

Promotions the server applies on its own at checkout — the Algerian COD market has no coupon box. Three kinds: Buy X Get Y, Buy X Get Free Delivery, and Quantity Pricing.

## Language

### Offer Anatomy

**Offer**:
A promotion applied automatically to a product at checkout. The merchant configures it; the shopper never enters anything.
_Avoid_: Coupon, discount code, promo code (a coupon is something a shopper enters — a separate concept)

**Trigger**:
The product an offer is about, optionally locked to one variant, and the quantity that qualifies.
_Avoid_: Condition, requirement

**Counted Units**:
The units an offer judges a basket by: every line of the product across its variants, or only the variant the offer is locked to.
_Avoid_: Total quantity (ambiguous once variants are locked)

**Reward**:
The goods a Buy X Get Y offer gives: a product and quantity added to the order at no charge, once per order whatever the quantity bought.
_Avoid_: Prize, bonus

**Free Delivery Offer**:
An offer whose benefit is delivery itself: the delivery fee drops to zero, for a basket of that product alone.
_Avoid_: Shipping discount

**Quantity Pricing**:
An offer that prices a product by how many are bought, through Price Tiers ("1 for 2,000 DA, 2 for 3,500 DA, 3 for 4,500 DA").
_Avoid_: Bundle, volume discount, pack offer

**Price Tier**:
One step of Quantity Pricing: from a quantity, a price for that many — and optionally free delivery. The highest tier the Counted Units reach applies, its per-unit price covering every unit.
_Avoid_: Level, bracket

**Schedule**:
Optional start and end. No start means live immediately; no end means it never expires; an end always comes after the start.
_Avoid_: Campaign window

**Offer Status**:
A manual `active` / `inactive` switch. Only an active offer within its schedule is live.
_Avoid_: Enabled flag

### Application

**One Offer per Product**:
A product gets at most one offer per order. Among those it qualifies for, the shopper's pick wins if it qualifies on its own; otherwise the highest threshold reached. Quantity Pricing is never live beside another offer for the same product.
_Avoid_: Stacking

**Live Offer**:
An offer active and within its schedule right now.

**Reward Left Out**:
A reward the stock cannot cover — once the units the shopper pays for are counted — is left out of the order; the order still goes through.
_Avoid_: Out-of-stock error

## Boundaries

- **Where application happens**: the storefront checkout and its cart quote apply offers through one pricing path, so what the shopper is shown is what the order charges.
- **Delivery fee mechanics**: Shipping Profiles context — an offer can make the fee zero, never compute it.
- **Trigger / reward products**: Products context — deleting a product deletes the offers about it.
- **Order lines**: Orders context — a line records the offer that priced it, and a reward line is marked as a reward.
- **Coupons** (planned): a shopper-entered code — a different concept from an offer, applied after offers.

## Edge Cases

**A locked variant counts alone**: "Buy 2 Red" needs two Red; one Red and one Blue do not qualify.

**A mixed basket earns no offer free delivery**: free delivery from an offer or a tier needs a basket of that product alone; a mixed basket earns free delivery only from the store's threshold.

**Tiers share their price across sizes**: two sizes bought under one tier pay the tier's price together, split so the lines add up to it exactly.

**Deleting products deletes offers**: no offer outlives the product it is about.
