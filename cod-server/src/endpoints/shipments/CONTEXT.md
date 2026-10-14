# Shipments Context

The delivery of a handed-off order: by an integrated carrier or by the store's
own driver, from handoff until the parcel is delivered, returned to the
merchant, or voided.

## Language

### Core Entities

**Shipment**:
One delivery execution of one order. An order has at most one.
_Avoid_: Fulfillment, dispatch, parcel (as the entity)

**Shipment Kind**:
`carrier` (an integrated delivery company) or `driver` (the store's own
driver). A driver is not a carrier.
_Avoid_: Delivery method

**Carrier**:
A delivery company integrated through an adapter (Yalidine, ZR Express, NOEST,
an EcoTrack-platform company). One configured carrier company is one
connection with its own credentials.
_Avoid_: Provider (for the company), courier, delivery partner

**Carrier Parcel ID**:
The carrier's stable identifier for the parcel, used to match its updates.
May differ from the tracking number, which some carriers change.
_Avoid_: External ID

**Tracking Number**:
The identifier the carrier prints on the label and shows the customer.
_Avoid_: Waybill, AWB

### What the Carrier Says

**Provider Status**:
A status exactly as the carrier (or, for drivers, the merchant) reported it,
e.g. `Retour vers vendeur`, `livred`, `en_hub`. Authoritative.
_Avoid_: Normalized status, shipment status

**Shipment Event**:
One reported provider status, with its reason, time and source.
_Avoid_: Tracking log, webhook event

**Reason**:
The carrier's explanation attached to an event: why an attempt failed
(`Client ne répond pas`, `Client incapable de payer`) or why a parcel is held.
_Avoid_: Comment, note

**Interpretation**:
What CodFlow understands a provider status to mean: a milestone, a failed
attempt, an exception, a collection signal, progress, or unknown.
_Avoid_: Mapping, status translation

### What CodFlow Concludes

**Milestone**:
A fact about the delivery, recorded once with the time it happened.
_Avoid_: Status, state

**Out for Delivery**:
The parcel reached the final mile: with a courier, or waiting at the stop desk
for the customer.
_Avoid_: In transit, en route

**Delivered**:
The customer received the parcel. Says nothing about money.
_Avoid_: Completed, paid, collected

**Return Started**:
The parcel is on its way back to the merchant. Stock is not back yet.
_Avoid_: Returned (for a return in progress)

**Returned**:
The goods are physically back with the merchant. The only moment stock comes
back.
_Avoid_: Return requested, refused

**Failed Attempt**:
A delivery attempt that did not succeed; the parcel may be tried again.
_Avoid_: Failure, refusal (unless the reason says so)

**Closed Shipment**:
A shipment that is delivered, returned or cancelled. Later events are kept
but change nothing.
_Avoid_: Terminal status

**Needs Attention**:
The carrier reports something the merchant must act on — an alert, a blocked
or suspended parcel, a return waiting to be collected, an abandoned parcel, or
a handoff whose outcome is unknown.
_Avoid_: Problem, error

### Handoff

**Reservation**:
The shipment row written before the carrier is called, so an order can never
be sent twice.
_Avoid_: Draft, pending shipment

**Unknown Handoff**:
A creation whose outcome the carrier did not make clear (timeout, outage).
Resolved by finding the parcel by our reference, or by the merchant attaching
the tracking number or releasing the shipment. Never retried automatically.
_Avoid_: Failed dispatch, pending

**Void**:
Undoing a shipment that never delivered anything (deleted at the carrier
before pickup, driver unassigned, or released after an unknown handoff). The
order becomes Ready to ship again.
_Avoid_: Cancel (that is the carrier's word for its own cancellation)

### Money (not this context)

**Collection Signal**:
A carrier saying it collected or paid out the cash (`encaisse`,
`paye_et_archive`). It implies Delivered and is kept as history; settlement
itself belongs to the settlement domain.
_Avoid_: Delivered (as a synonym), payment status

## Boundaries

- **Order statuses, Order Stage, line returns** — Orders context.
- **Driver payroll, remittances, fee payments** — Driver settlement. A driver
  shipment is what settlement settles; the shipment holds no payment state.
- **Webhook Event** — the integration inbox: receipt, retry and raw payload,
  not delivery history.
