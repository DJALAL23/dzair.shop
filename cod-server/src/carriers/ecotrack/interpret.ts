/**
 * What EcoTrack's statuses mean to CodFlow (every EcoTrack-platform company).
 *
 * EcoTrack speaks two documented vocabularies (Postman collection,
 * `.agents/skills/Ecotrack/`):
 *   - `activity` — a parcel's history (`get/tracking/info`), one key per event;
 *   - `status`   — the sender-dashboard buckets (`get/orders`, `get/orders/status`).
 *
 * Both carry money states next to delivery ones: `encaissed` / `payed`,
 * `encaisse_non_paye` / `paiements_prets` / `paye_et_archive`. They mean the
 * parcel was delivered and say where the cash is — collection signals, never
 * a delivery status. `return_asked` is a return *initiated by the sorting
 * centre*; the goods are back only at `Return_received` / `retour_recu`, which
 * EcoTrack sets once the merchant confirms reception (`valid/returns`).
 * `suspendu` is the carrier holding the parcel — the merchant's attention,
 * not the order's processing status.
 */

import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import type { CarrierStatus } from "../contract";

const progress: Interpretation = { kind: "progress" };
const outForDelivery: Interpretation = { kind: "milestone", milestone: "out_for_delivery" };
const delivered: Interpretation = { kind: "milestone", milestone: "delivered" };
const returnStarted: Interpretation = { kind: "milestone", milestone: "return_started" };
const returned: Interpretation = { kind: "milestone", milestone: "returned" };
const collection: Interpretation = { kind: "collection" };

export const ECOTRACK_ACTIVITIES: Readonly<Record<string, Interpretation>> = {
  order_information_received_by_carrier: progress,
  picked: progress,
  accepted_by_carrier: progress,
  dispatched_to_driver: outForDelivery,
  attempt_delivery: { kind: "failed_attempt" },
  return_asked: returnStarted,
  return_in_transit: returnStarted,
  Return_received: returned,
  livred: delivered,
  encaissed: collection,
  payed: collection,
  /** A remark was added — not a status (observed live, undocumented). */
  notification_on_order: progress,
};

export const ECOTRACK_STATUSES: Readonly<Record<string, Interpretation>> = {
  prete_a_expedier: progress,
  en_ramassage: progress,
  en_preparation_stock: progress,
  vers_hub: progress,
  en_hub: progress,
  vers_wilaya: progress,
  en_preparation: progress,
  en_livraison: outForDelivery,
  suspendu: { kind: "exception" },
  livre_non_encaisse: delivered,
  encaisse_non_paye: collection,
  paiements_prets: collection,
  paye_et_archive: collection,
  retour_chez_livreur: returnStarted,
  retour_transit_entrepot: returnStarted,
  retour_en_traitement: returnStarted,
  retour_recu: returned,
  retour_archive: returned,
  annule: { kind: "milestone", milestone: "cancelled" },
};

export function interpretEcotrack(status: CarrierStatus): Interpretation {
  const table = status.vocabulary === "activity" ? ECOTRACK_ACTIVITIES : status.vocabulary === "status" ? ECOTRACK_STATUSES : null;
  return (table && Object.hasOwn(table, status.value) ? table[status.value] : null) ?? { kind: "unknown" };
}
