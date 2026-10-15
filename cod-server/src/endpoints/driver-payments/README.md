# Driver Payments & Settlement API

Settling with the store's own drivers: the cash a driver collected on delivery, and the fee the store owes the driver for it. For the driver registry and per-wilaya pay, see [`/api/drivers`](../drivers/README.md).

---

## Directory Structure

```
src/endpoints/driver-payments/
├── ai-tools.ts                # AI/MCP tools (3)
├── driver-payments.test.ts    # Request schema tests
├── settlement.e2e.test.ts     # Settlement on real D1: payments, races, reconciliation, order deletion
├── handlers.ts                # HTTP handlers
├── refusals.ts                # A refused payment as an API error (routes and AI tools)
├── routes.ts                  # @hono/zod-openapi routes with RBAC scopes
├── validation.ts              # Request schema
└── README.md                  # This file
```

The settlement itself is `cod-shared/queries/driver-payments.ts`.

---

## Core Concepts

An order given to a driver is a **driver shipment** (`POST /api/orders/{id}/shipment` with `kind: "driver"`). Its cash to collect (`codAmount`) and the driver's fee (`driverFee`, from the driver's pay for the order's wilaya) are frozen on it. When the merchant reports it delivered, the driver is credited once: `totalDelivered` + 1, `totalEarnings` + fee, `pendingCash` + cash.

A delivered shipment has two parts to settle, **each once**: the **cash** (`cod`) and the **fee** (`fee`). A payment settles parts of one driver's delivered shipments; each settled part is a `driver_payment_lines` row, unique per shipment and part.

| Type | What happens | Parts settled | Driver counters |
| :--- | :--- | :--- | :--- |
| `cod_remittance` | The driver hands over the cash collected | cash | `pendingCash` − cash total, `totalPaid` + cash total |
| `fee_payment` | The store pays the driver's fees | fee | unchanged |
| `net_settlement` | Both at once: the driver hands over the cash less the fees | cash and fee | as `cod_remittance` |

**The amount is computed, never sent:** `sum(codAmount)`, `sum(driverFee)`, or their difference, from the shipments' frozen values.

**Atomic and once:** the payment, its lines and the driver's counters are one D1 batch. A part already settled refuses the whole payment, including when two payments for the same shipment are recorded at the same moment (the unique line decides; the loser is refused with nothing recorded).

**Reconciliation:** the driver's `pendingCash` should equal the cash of their delivered shipments with no cash line. `GET /api/drivers/{id}` returns `cashReconciliation` with the difference as `drift`.

**Deleting an order:** a delivered driver order not yet settled takes its credit back with it (the three counters); once any part of it is settled, the order cannot be deleted (`409 ORDER_HAS_SETTLEMENT`) — the payment keeps it.

---

## Endpoints

### `POST /api/driver-payments` — record a payment

Requires `delivery:manage`.

```json
{
  "driverId": "c1f76d49-411a-4d76-8051-92b19e2bf471",
  "type": "cod_remittance",
  "shipmentIds": ["5c20a1e4-…", "8b1e42a0-…"],
  "notes": "Remise du soir"
}
```

* `shipmentIds` — 1 to 500 of the driver's delivered shipments, each listed once.

`201` returns the payment: `id`, `driverId`, `type`, `amount`, `orderCount` (shipments settled), `notes`, `createdBy`, `createdByName`, `createdAt`.

### `GET /api/driver-payments/{driverId}` — payment history

Requires `delivery:read`. Newest first; an empty array when there are none.

### `GET /api/driver-payments/{driverId}/pending` — what is still to settle

Requires `delivery:read`. The driver's delivered shipments with the cash, the fee, or both unsettled, newest delivery first:

```json
{
  "success": true,
  "data": [
    {
      "shipmentId": "5c20a1e4-…",
      "orderId": "8b1e42a0-…",
      "orderNumber": "ORD-2026-0042",
      "customerName": "Karim Benali",
      "codAmount": 1900,
      "driverFee": 300,
      "deliveredAt": "2026-01-20T14:30:00.000Z",
      "codPaymentId": null,
      "feePaymentId": null
    }
  ]
}
```

---

## AI & MCP Tools (`ai-tools.ts`)

| Tool | Purpose | Key parameters |
| :--- | :--- | :--- |
| `listDriverPayments` | A driver's payment history | `driverId` |
| `getPendingSettlements` | The driver's delivered shipments with the cash or fee unsettled | `driverId` |
| `createDriverSettlement` | Record a payment for those shipments | `driverId`, `type`, `shipmentIds`, `agentName`, `notes` |

---

## Errors

| HTTP | Code | Cause |
| :--- | :--- | :--- |
| `400` | `VALIDATION_FAILED` | No shipments, a shipment listed twice, more than 500, a missing field or an unknown type |
| `422` | `SHIPMENT_NOT_SETTLEABLE` | A shipment is not one of this driver's delivered shipments (`context.shipmentIds`) |
| `422` | `PAYMENT_ALREADY_SETTLED` | A part this payment settles already is (`context.kind`: `"cod"` or `"fee"`, `context.shipmentIds`) |
| `401` | `UNAUTHENTICATED` | Missing or invalid API key or OAuth bearer token |
| `403` | — | Missing `delivery:read` or `delivery:manage` |
