# Orders Context

A customer's cash-on-delivery order and the merchant's processing of it, up to
the moment it is handed to delivery. What happens to the parcel afterwards
belongs to the Shipments context.

## Language

### Core Entities

**Order**:
A customer's request to buy products, paid in cash when the parcel arrives.
_Avoid_: Purchase, transaction, sale

**Order Number**:
The human-readable identifier (`ORD-20260824-0042`), also sent to carriers as
our reference for the parcel.
_Avoid_: Order ID (that's the UUID), reference number

**COD Amount**:
What the customer owes at the door: product price plus delivery fee.
_Avoid_: Total, amount due, collection amount

**Customer**:
The person receiving and paying for the order.
_Avoid_: Client, buyer, end user

### Processing Statuses

**New**:
Placed, not yet confirmed by the merchant.
_Avoid_: Pending, created, draft

**Confirmed**:
The customer confirmed the order by phone (or the merchant accepted it).
_Avoid_: Accepted, validated, approved

**Unreachable**:
The customer did not answer the confirmation calls; the order waits for
another attempt.
_Avoid_: No answer, failed contact, suspended

**Preparing**:
The merchant is packing the order. An optional step.
_Avoid_: In preparation, processing, packing

**Ready**:
Processing is finished; the order may be handed off. It stays Ready after
handoff — delivery progress is the Shipment's, not the Order's.
_Avoid_: Prepared, staged, shipped

**Cancelled**:
The order ended before delivery. Not possible while it has a Shipment.
_Avoid_: Deleted, voided, rejected

### Handoff

**Handoff**:
Giving a Ready order to delivery: creating its Shipment, with a carrier or the
store's own driver. The boundary between Orders and Shipments.
_Avoid_: Dispatch (as a status), assignment (as a status)

**Order Stage**:
The single label shown for an order, derived from its status and its
Shipment's milestones (e.g. *ready to ship*, *out for delivery*, *returning*).
Read-only; never stored or written.
_Avoid_: Status (for the combined label)

### Financial

**Price**:
Product subtotal, excluding the delivery fee.
_Avoid_: Product total, item cost, subtotal

**Delivery Fee**:
What the customer is charged for delivery, fixed when the order is placed.
_Avoid_: Shipping fee, freight charge

### Returns at the Door

**Line Return**:
Recording that the customer refused some units of one product line.
_Avoid_: Item return, SKU return

### Algerian Specifics

**Wilaya**:
Algerian province (1–58); decides delivery zones and fees.
_Avoid_: State, region

**Commune**:
Municipality within a wilaya; the precise destination.
_Avoid_: City, district

**Stop Desk**:
A carrier's pickup point where the customer collects the parcel, instead of
home delivery. The order records what the customer asked for; the Shipment
records what was actually shipped.
_Avoid_: Pickup point, relay point

## Edge Cases

**Handoff only from Ready**: a new, unconfirmed or unreachable order cannot be
handed to delivery. `confirmed → ready` exists for shops with no packing step.

**One shipment at most**: an order has zero or one Shipment. Voiding a Shipment
frees the order for a new handoff; a returned or delivered Shipment does not —
sending the goods again is a new order.

**Edits after handoff**: once a Shipment exists, the order's address, wilaya,
commune, phone and delivery type are locked; changing the parcel goes through
the Shipment, when its carrier allows it.

**Auto-customer creation**: an order whose customer does not exist yet creates
the customer from the order data.
