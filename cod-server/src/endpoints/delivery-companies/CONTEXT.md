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

### Places

**Map of Places** (`carrier_places`):
Where a company delivers, in its carrier's own terms: one row per commune of ours that the carrier's list names, with the carrier's ids and spellings for the commune and the wilaya it files it under, and whether it delivers to the door there. Built from the carrier's list with the one spelling rule (`communeNamed`, Wilayas context) on connect, from the company's page, and every hour for a map never read or a week old.
_Avoid_: Geo names, name map, zone sync

**Carrier Place**:
One entry of a carrier's own list: its wilaya (id, number, name on the carrier's map) and its commune (id, name). Carriers are on older maps than the law: in November 2026 all three live lists filed the communes law 26-06 moved under their 2019 wilaya, and each has its own placements (Yalidine has El Borma under Touggourt, NOEST Tabelbala under Béchar).
_Avoid_: Territory (ZR's word), zone

**Destination**:
What a parcel is addressed to: the Carrier Place the company's map holds for the order's commune — never a name the carrier did not give. A commune the map lacks is refused before anything is sent (`PLACE_NOT_SERVED`), a home parcel to a commune without door delivery too, and every parcel while the map was never read (`CARRIER_PLACES_NOT_READ`).
_Avoid_: Fallback name, reference name

**Unmatched Place**:
A place in a carrier's list that no commune of ours has the spelling of, shown on the company's page and never sent to. Fixed by adding the spelling to `cod-shared/places`, not in code.
_Avoid_: Unmapped commune

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
What a delivery company charges the store for one parcel to a commune, by
delivery type (home or stop desk). The store's cost, never the customer's
price (that is a shipping profile). Read from the carrier's own API, with the
merchant's account prices, together with its places, and kept on the company's
map (ZR and Yalidine price per commune, NOEST and EcoTrack per wilaya). The
map is replaced only when places and prices were both read. A carrier that
writes 0 for a delivery gives no price there. The base price only: weight
surcharges and COD percentages are not counted.
_Avoid_: Shipping rate, delivery fee, tariff (alone)

**Return Fee**:
What the company charges the store for a parcel that comes back, by how it was
sent. A return fee of 0 is a free return.
_Avoid_: Return cost, refusal fee

**Shipping Cost**:
What a carrier shipment costs the store: its company's Carrier Rate and Return
Fee for its destination and delivery type, frozen at handoff, as a driver
shipment freezes the driver's fee. A parcel moved to another commune takes the
rate there; a later change of rates never rewrites a past parcel. None when the
company gives no price for the place.
_Avoid_: Delivery cost, carrier fee

### Stop Desks

**Stop Desk Sync**:
Pulling a carrier's desks into the local cache, from the company's page and with the hourly refresh of its places. Reads never call the carrier; desks the carrier dropped are removed on the next sync, and the merchant's on/off choice is kept. Each desk is placed in a commune of ours through the map of places (by the carrier's commune id, or by its commune, then its name, under its wilaya number) and offered under that commune's wilaya; a desk placed nowhere is kept but offered under no wilaya.
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
