# Payments Context

How cash and fees move between the shop and its own drivers: settling the
shipments a driver delivered, each part once, and keeping the driver's ledger
honest. Carrier companies' payouts are not settled here.

## Language

### Settlement Types

**Settlement**:
One payment recording money that changed hands for a batch of a driver's delivered shipments. The only way money "moves" in the system — everything else is bookkeeping.
_Avoid_: Payout, payoff, transaction

**COD Remittance**:
The driver hands the collected customer cash back to the shop (Driver → Shop). Settles each shipment's `cod` part.
_Avoid_: Cash deposit, collection return

**Fee Payment**:
The shop pays the driver their fees (Shop → Driver). Settles each shipment's `fee` part; the cash is untouched.
_Avoid_: Salary, wage payment, commission payout

**Net Settlement**:
Both at once: the driver remits the cash less their fees (still Driver → Shop). Settles both parts of every shipment in it — so it takes only shipments with neither part settled.
_Avoid_: Combined payment, hybrid settlement

### Mechanics

**Payment Record**:
The permanent receipt of a settlement: type, amount, shipment count, who recorded it. Append-only — no endpoint edits or deletes one.
_Avoid_: Invoice, receipt log

**Payment Line**:
One part (`cod` or `fee`) of one shipment, settled by one payment (`driver_payment_lines`). Unique per shipment and part: a part is settled once, ever.
_Avoid_: Stamp, paid flag

**Server-Authoritative Amount**:
Settlement amounts are never taken from the caller: the server sums the shipments' frozen cash and fees.
_Avoid_: Calculated total, auto amount

**Frozen Driver Fee**:
The driver's fee for the wilaya, copied onto the shipment when the order is given to the driver; later pay-rate changes never touch it.
_Avoid_: Current rate, retroactive fee

**Double-Settlement Guard**:
A payment naming a part already settled — or settled by a payment recorded at the same moment — is refused whole, with nothing recorded (`PAYMENT_ALREADY_SETTLED`). The payment, its lines and the ledger change in one batch.
_Avoid_: Duplicate check, replay protection

**Pending Settlements**:
A driver's delivered shipments with the cash, the fee, or both still to settle (`codPaymentId` / `feePaymentId` null). The pre-settlement review list.
_Avoid_: Unsettled orders, open balance

**Audit Attribution**:
Every Payment Record names who recorded it: the signed-in user, or for an AI agent the person who granted its access. Never overridable.
_Avoid_: Created by field, user stamp

### Ledger & Balances

**Pending Cash**:
Customer cash a driver has collected but not yet remitted — a liability of the driver. Grows when a delivery is recorded, shrinks with a COD Remittance or Net Settlement.
_Avoid_: Cash on hand, wallet balance

**Total Earnings**:
Cumulative frozen fees of the driver's deliveries — a liability of the shop.
_Avoid_: Salary earned, payout balance

**Total Paid**:
Cumulative customer cash the driver has handed back.
_Avoid_: Payouts received, salary paid

**Cash Drift**:
Pending Cash against the cash of delivered shipments with no `cod` line. Non-zero means the counter and the shipments disagree (an old bug, a hand edit); the driver page shows it.
_Avoid_: Discrepancy, mismatch

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Driver identity, availability, vehicle, pay grid**: `drivers/` (a wilaya with no fee in the grid pays 0)
- **When a delivery is recorded**: the shipment's delivered milestone (`shipments/`), reported by the merchant for a driver
- **COD Amount composition** (items + delivery fee − discounts): Orders
- **What the customer pays for delivery**: shipping profiles — never reconciled against what drivers are paid

## Edge Cases

**Not the driver's delivered shipment**: any shipment in the request that is not a delivered shipment of this driver refuses the whole payment (`SHIPMENT_NOT_SETTLEABLE`, naming them).

**Net Settlement can land at zero or below**: when fees meet or exceed the cash, the amount is ≤ 0; legal, worth watching.

**Counters move by the cash, never the net**: a Net Settlement lowers Pending Cash and raises Total Paid by the full cash.

**A delivery keeps its order**: an order with a shipment — settled or not — cannot be deleted (`ORDER_HAS_SHIPMENT`), so a payment line never loses its shipment and a driver's counters never move behind the merchant's back. A finished order is archived instead.

**No currency column**: all money is DZD.
