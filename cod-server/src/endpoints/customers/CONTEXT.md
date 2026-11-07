# Customers Context

Who buys from the store: people identified by their phone number, what their orders add up to, and the segments merchants sort them into.

## Language

### Identity

**Customer**:
A person who places COD orders, keyed by phone number. Not a login — dashboard users live in a different system entirely.
_Avoid_: User, account, buyer, client

**Primary Phone**:
The customer's identity anchor: Algerian mobile format and unique across every customer. Duplicate attempts are refused, not merged.
_Avoid_: Contact number, mobile

**Secondary Phone**:
An optional extra number with no uniqueness rule — two customers may share one.
_Avoid_: Alternate contact ID

**Place Snapshot**:
The Arabic display names for wilaya and commune stored directly on the customer alongside their IDs. The IDs are authoritative; the names are refreshed only when this customer is written.
_Avoid_: Live lookup, resolved location

### Customer Totals

Read from the customer's orders every time — never stored, so they cannot
drift from them.

**Total Orders**:
Every order this customer placed and that still exists, in any status.
_Avoid_: Order count today, active orders

**Total Spent**:
The goods of the customer's delivered orders, net of the units refused at
the door. A placed, travelling, returned or cancelled order spent nothing.
_Avoid_: Lifetime value, revenue, running total

**Last Order At**:
When the customer placed their newest order.
_Avoid_: Last activity, last login

### Segmentation & History

**Group Membership**:
Belonging to a named segment (e.g. VIP) recorded with an assignment timestamp. Groups are owned by `customer-groups/`.
_Avoid_: Category, tier

**Tag Assignment**:
A free-form label attached with an assignment timestamp. Tags are owned by `customer-tags/`.
_Avoid_: Note, flag

**Order History**:
The customer's complete order list, newest first, each carrying its full status history and joined Arabic place names.
_Avoid_: Purchase log, receipts

**Recent Orders**:
At most ten newest orders embedded in the profile detail — a convenience snapshot, not the full history.
_Avoid_: Order queue

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Creating customers from walk-in orders**: Orders context auto-creates a Customer when checkout names an unknown phone
- **Group / Tag management**: `customer-groups/` and `customer-tags/` own those lifecycles
- **Geography IDs and formats**: Wilayas context
- **Delivered, refused units**: Shipments and Orders own when a parcel is delivered and which units came back; Customer Totals only read them

## Edge Cases

**Customers with history are immortal**: One order — any status — permanently blocks deletion; there is no soft-delete escape hatch for customers.

**Orders and spend diverge on purpose**: a returned or cancelled order counts in Total Orders and never in Total Spent.

**Place Snapshots age independently**: Renaming or re-mapping reference geography never rewrites existing customers; snapshots refresh only when that customer is edited.

**Phone uniqueness stops at the app layer**: Enforced on create and on phone changes with a friendly conflict; the database itself imposes no unique constraint on it.
