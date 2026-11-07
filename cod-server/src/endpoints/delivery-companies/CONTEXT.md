# Delivery Context

The carrier companies a store ships with in Algeria: how each is connected,
what its carrier can do, how its updates reach CodFlow, and its stop desks. An
order's delivery itself — the shipment, its handoff, history and actions —
is the Shipments context (`shipments/CONTEXT.md`).

## Language

### Carrier Setup

**Delivery Company**:
A carrier account the store ships with (Yalidine, Guepex, ZR Express, NOEST, an EcoTrack-platform courier). Holds credentials, settings and the delivery types it offers — never prices: what the customer pays comes from shipping profiles, what the carrier invoices is settled outside CodFlow.
_Avoid_: Shipper, logistics partner, courier account

**Provider**:
The carrier platform a company runs on, naming the adapter that talks to it: `yalidine` (Yalidine and Guepex), `zr_express`, `noest`, `ecotrack` (the 82 EcoTrack couriers). Set when the company is created, never guessed from its code; a company with none cannot take parcels.
_Avoid_: Company code (that only identifies the company), brand

**Provider Settings** (`providerConfig`):
What the platform needs beyond credentials, validated by the adapter: Yalidine's platform (`yalidine` | `guepex`) and sender's wilaya, ZR's own state names (`statusMap`). Secrets in it leave the server masked.
_Avoid_: Notes (free text for the team, never settings)

**Connection**:
API credentials stored for a company. Write-only — responses say `isConnected`, never the tokens.
_Avoid_: Linked, paired, activated

**Capabilities**:
What a company's carrier can do at all, known from its provider alone: home and stop-desk delivery, separate validation, bulk creation, the parcel fields it takes, edit, cancel, remarks, label, history, find by reference, new attempts, returns, and how updates arrive. A shipment's actions are computed from them.
_Avoid_: Features, supports flags

**Auto-Validate**:
Whether a created parcel is sent to the courier at once (`true`) or waits for the team to validate it (`false`, the default for EcoTrack couriers, whose parcels lock once validated).
_Avoid_: Auto-confirm, auto-approve

### Updates

**Webhook Carrier**:
Yalidine and ZR Express push status updates. ZR's endpoint is registered in one click (its signing secret is fetched and stored); Yalidine's secret is pasted from its dashboard. A company is recognised by whose secret verifies the signature.
_Avoid_: Live carrier

**Pull Carrier**:
EcoTrack couriers, NOEST and Guepex push nothing: their open parcels are read every five minutes by the cron and on demand ("Check shipments now", `sync-shipments`).
_Avoid_: Polling carrier

**Webhook Inbox**:
Every pushed event, stored once, answered at once and processed after (`webhook_events`): `ok`, `ignored`, `unmatched` (no shipment has that parcel), `unknown_status` (recorded, but not understood), `deferred_settlement` (a money event), `error` (retried with backoff) or `dead` (tries spent). What went wrong can be processed again by hand.
_Avoid_: Webhook log

**ZR State Names**:
ZR tenants can rename their states. A name ZR's standard workflow does not know is mapped by the merchant to what it means for the delivery (out for delivery, delivered, returned…); a name nobody mapped is an unknown status, never guessed.
_Avoid_: Status mapping to order statuses (orders have no delivery statuses)

### Costs

**Carrier Rate**:
What a delivery company charges the store for one parcel, for a wilaya and a
delivery type (home or stop desk). The store's cost, never the customer's
price (that is a shipping profile).
_Avoid_: Shipping rate, delivery fee, tariff (alone)

**Return Fee**:
What the company charges the store for a parcel that comes back.
_Avoid_: Return cost, refusal fee

**Shipping Cost**:
What a shipment cost the store, frozen when it was handed off from its
company's Carrier Rate (and its Return Fee when it came back), as a driver
shipment freezes the driver's fee.
_Avoid_: Delivery cost, carrier fee

### Stop Desks

**Stop Desk Sync**:
An explicit action pulling a carrier's desks into the local cache. Reads never call the carrier; desks the carrier dropped are removed on the next sync, and the merchant's on/off choice is kept.
_Avoid_: Import, refresh, live lookup

**Station Code**:
A carrier's identifier of a pickup desk, required on a stop-desk parcel (postal code for EcoTrack, station code for NOEST, center id for Yalidine, territory UUID for ZR).
_Avoid_: Desk ID, branch code

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Shipment, handoff, milestones, a shipment's actions**: Shipments (`shipments/`)
- **Order processing and stage**: Orders (`orders/`)
- **The store's own drivers and their settlement**: Drivers and Payments
- **Delivery fees**: shipping profiles — carriers never price a delivery

## Edge Cases

**A company that carried a shipment is never deleted**: `COMPANY_HAS_ACTIVE_SHIPMENTS` while one is open, `COMPANY_HAS_SHIPMENTS` after; set it inactive. One that never carried any goes with its call log and inbox.

**An inactive company keeps its parcels**: its open shipments can still be labelled, edited, cancelled and synced.

**Webhook contract**: receivers answer at once and store each event once; processing never runs before the answer.
