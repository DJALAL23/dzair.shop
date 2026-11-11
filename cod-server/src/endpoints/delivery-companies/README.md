# Delivery Companies API

The carrier companies a store ships with — Yalidine, Guepex, ZR Express,
NOEST and the EcoTrack-platform couriers: their credentials and settings,
what their carrier can do, how their updates reach Wocart, their stop desks,
and their webhook inbox.

Handing an order to a carrier, and everything done to its parcel after, is
the Shipments API (`/api/orders/{id}/shipment`, `/api/shipments/…`).
Customer delivery pricing is [`/api/shipping-profiles`](../shipping-profiles/README.md);
the store's own drivers are [`/api/drivers`](../drivers/README.md).

## Directory structure

```
src/endpoints/delivery-companies/
├── handlers.ts         # CRUD, stop desks, places, connection test, sync, inbox
├── webhook-handlers.ts # ZR webhook registration, Yalidine secret
├── view.ts             # A company as the API shows it, with its capabilities
├── routes.ts           # Route definitions and their permissions
├── validation.ts       # Request schemas
├── ai-tools.ts         # listDeliveryCompanies (MCP)
└── queries.ts          # Re-exports cod-shared/queries/delivery-companies
```

The carrier adapters are in `src/carriers/` (one folder per provider, behind
`contract.ts`; `registry.ts` builds them).

## Providers

| Provider | Companies | Credentials | Settings (`providerConfig`) | Updates |
|---|---|---|---|---|
| `yalidine` | Yalidine, Guepex | `apiToken` (X-API-TOKEN), `apiUserGuid` (X-API-ID) | `platform` (`yalidine` \| `guepex`), `fromWilayaName` | Yalidine: webhook (pasted secret). Guepex: pulled every 5 minutes |
| `zr_express` | ZR Express | `apiToken` (X-Api-Key), `apiUserGuid` (X-Tenant) | `statusMap` — the tenant's own state names by meaning | Webhook (registered in one click) |
| `noest` | NOEST | `apiToken`, `apiUserGuid` | — | Pulled every 5 minutes |
| `ecotrack` | 82 EcoTrack couriers (`<name>_ecotrack`) | `apiToken`, `apiEndpoint` (the courier's host) | — | Pulled every 5 minutes |

A company is created with its `provider`; one created without it has none
and cannot take parcels — the provider is never guessed from the code.
`autoValidate` defaults to `false` for EcoTrack couriers (their parcels lock
when validated) and `true` for the others.

## A company as the API shows it

Credentials leave as `isConnected`, the webhook signing secret as
`webhookSecretSet`; secrets inside `providerConfig` are masked (`••••` and the
last four characters). Each company carries its carrier's `capabilities`
(null without a provider):

```json
{
  "id": "comp_yalidine_01",
  "name": "Yalidine",
  "nameAr": "ياليدين",
  "code": "yalidine",
  "active": true,
  "isConnected": true,
  "provider": "yalidine",
  "providerConfig": { "platform": "yalidine", "fromWilayaName": "Alger" },
  "capabilities": { "homeDelivery": true, "stopDesk": true, "updates": "webhook", "history": true, "label": true, "...": "…" },
  "supportsHomeDelivery": true,
  "supportsStopDesk": true,
  "autoValidate": true,
  "webhookSecretSet": true,
  "webhookEndpointId": null,
  "notes": null,
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-01-20T14:30:00.000Z"
}
```

## Endpoints

| Route | Permission | What it does |
|---|---|---|
| `GET /api/delivery-companies` | `delivery:read` | List (`active`, `search`, `limit`, `offset`) |
| `GET /api/delivery-companies/{id}` | `delivery:read` | One company, with its map of places (`places`: communes, home, priced, unmatched, when read) |
| `POST /api/delivery-companies` | `delivery:create` | Create — `provider`, `providerConfig`, credentials |
| `PATCH /api/delivery-companies/{id}` | `delivery:update` | Update; `providerConfig` is merged into the stored settings and validated by the adapter |
| `DELETE /api/delivery-companies/{id}` | `delivery:delete` | Refused once it carried a shipment: `COMPANY_HAS_ACTIVE_SHIPMENTS` while one is open, `COMPANY_HAS_SHIPMENTS` after — set it inactive instead |
| `GET /api/delivery-companies/{id}/stop-desks` | `delivery:read` | The cached desks (`wilayaId`, `activeOnly`) — never calls the carrier |
| `POST /api/delivery-companies/{id}/sync-stop-desks` | `delivery:manage` | Pull the carrier's desks; the merchant's on/off choice survives |
| `PATCH /api/delivery-companies/{id}/stop-desks/{code}/toggle` | `delivery:manage` | Turn one desk on or off |
| `POST /api/delivery-companies/{id}/sync-places` | `delivery:manage` | Read the carrier's list of places and its prices into the company's map; the map is replaced only when both were read |
| `GET /api/delivery-companies/{id}/rates` | `delivery:read` | What the company charges the store, by our wilaya: home, stop desk and return, each the lowest and highest price among the wilaya's communes |
| `POST /api/delivery-companies/{id}/test-connection` | `delivery:read` | Check the stored credentials at the carrier (EcoTrack couriers) |
| `POST /api/delivery-companies/{id}/sync-shipments` | `delivery:manage` | Read the history of up to 50 open shipments now, the longest unchecked first (`synced`, `recorded`, `reached`, `moreRemain`) |
| `POST` / `DELETE /api/delivery-companies/{id}/webhook/register` | `delivery:manage` | Register / remove ZR's webhook endpoint (its secret is stored) |
| `PATCH /api/delivery-companies/{id}/webhook/secret` | `delivery:manage` | Store Yalidine's webhook secret |
| `GET /api/delivery-companies/{id}/webhook/events` | `delivery:read` | The inbox, newest first, with each event's result, shipment, order, tries and next try (`result`, `limit`, `offset`) |
| `POST /api/delivery-companies/{id}/webhook/events/{eventId}/retry` | `delivery:manage` | Process an event that ended `error`, `dead`, `unmatched` or `unknown_status` again, now |

## Errors

Errors use the platform's envelope (`error`, `code`, `category`, `context`).

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | An invalid body, or settings the adapter refuses |
| 400 | `MISSING_API_CREDENTIALS` | A carrier call on a company without credentials |
| 404 | `NOT_FOUND` | No such company, desk or inbox event |
| 409 | `DUPLICATE_ENTITY` | A company with that `code` exists |
| 409 | `COMPANY_HAS_ACTIVE_SHIPMENTS`, `COMPANY_HAS_SHIPMENTS` | Deleting a company that carried shipments |
| 409 | `VALIDATION_FAILED` | Retrying an event that is not retryable |
| 400 | `OPERATION_NOT_SUPPORTED` | A webhook setup for another provider (ZR registration on Yalidine) |
| 422 | `OPERATION_NOT_SUPPORTED` | An action the company's carrier cannot do (a connection test, a sync without history) |
| 502 | `EXTERNAL_API_FAILURE` | The carrier failed (network, timeout, its own error) |
| 403 | — | Missing the route's permission |
