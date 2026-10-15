# The money of an order delivered by the store's own driver

A beginner's guide to how cash and fees move when the shop delivers with its
own drivers. (A carrier company collects and pays out on its own; that is not
settled here.)

---

## 1. Three numbers that never meet

| Number | Set by | Answers |
|---|---|---|
| Customer delivery fee | Shipping profiles (per wilaya, per commune) | "What does the customer pay for delivery?" |
| Driver fee | The driver's pay grid (per wilaya) | "What do I pay this driver for this region?" |
| Payment | A settlement | "What cash or fees changed hands, for which deliveries?" |

A shop may charge the customer 600 DZD for delivery and pay the driver 350 DZD
for the same run: the two are decoupled on purpose.

## 2. The order is created

The delivery fee is resolved (product profile, else the store default; the
wilaya's rule and any commune override; then free-shipping offers), and:

    items + delivery fee − discounts = cash to collect (COD)

No driver is involved yet.

## 3. The order is given to a driver — the fee freezes

When a ready order is given to a driver (`POST /orders/{id}/shipment` with
`kind: "driver"`, or several at once through `/shipments/driver-bulk`), a
**shipment** is created with the cash to collect and the driver's fee for the
order's wilaya, copied from the pay grid. Changing the grid later never
changes this shipment: the books stay deterministic.

## 4. The delivery is recorded — the ledger moves

The merchant reports the driver's progress (`POST /shipments/{id}/events`):
out for delivery, a failed attempt, delivered, or the goods back. The
**delivered** milestone is set once, and only then the driver's ledger moves.
Mohamed delivers an order with 2,000 DZD to collect and a 500 DZD fee:

| Counter | Before | After |
|---|---|---|
| Total delivered | 0 | 1 |
| Total earnings | 0 DZD | 500 DZD |
| Pending cash | 0 DZD | 2,000 DZD |

No money changed hands yet: Mohamed holds the shop's 2,000 DZD (his
liability), and the shop owes him 500 DZD (its liability). Reporting
"delivered" twice changes nothing — the shipment is closed after the first.

## 5. Settling up — money moves

`POST /driver-payments` settles a batch of the driver's delivered shipments
(`shipmentIds`):

| Type | Meaning | Direction | Settles |
|---|---|---|---|
| `cod_remittance` | The driver hands over the cash | Driver → Shop | each shipment's `cod` part |
| `fee_payment` | The shop pays the fees | Shop → Driver | each shipment's `fee` part |
| `net_settlement` | Cash less fees | Driver → Shop | both parts |

The server checks every shipment is this driver's and delivered, computes the
amount from the frozen values (net: cash − fees), and records the payment, one
**payment line** per part, and the ledger change in one batch. A part already
settled — even by a payment recorded at the same moment — refuses the whole
payment, with nothing recorded.

## 6. What is left to settle

`GET /driver-payments/{driverId}/pending` lists the delivered shipments with
the cash, the fee, or both still open. The driver page shows them, the totals
owed each way, and a warning when the pending-cash counter disagrees with the
shipments (cash drift).

### Good habits

- Add the driver's fee for a wilaya **before** giving them orders there; a
  missing fee freezes as 0.
- Never edit the ledger counters by hand; they follow the shipments.
- A driver who has delivered is set inactive, never deleted — their history
  stays.

## 7. Where it lives

| What | Code |
|---|---|
| Customer fee | `cod-server/src/endpoints/orders/resolve-fee.ts` |
| Giving orders to a driver, freezing the fee | `cod-server/src/endpoints/shipments/driver-handoff.ts`, `cod-shared/shipments/handoff.ts` |
| Recording a delivery and its ledger effect | `cod-shared/shipments/record-events.ts` |
| Settlement | `cod-shared/queries/driver-payments.ts` |
| The receipts (tests) | `driver-payments/settlement.e2e.test.ts` |
