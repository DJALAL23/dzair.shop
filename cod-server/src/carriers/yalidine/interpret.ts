/**
 * What Yalidine's statuses mean to CodFlow.
 *
 * Yalidine's `last_status` / history `status` is a fixed French vocabulary of
 * 36 values, the same for every account (official docs, Parcels and Histories
 * sections). Live observation (2026-09-07, 272 events over 20 parcels) shows
 * the return flow `Echèc livraison → Retourné au centre ⇄ Retour vers centre →
 * Retour à retirer → Retourné au vendeur`: the parcel is only back with the
 * merchant at `Retourné au vendeur`; everything before is a return in transit,
 * and `Retour à retirer` / `Retour non retiré` mean the merchant must go and
 * collect it.
 *
 * `En attente du client` is a stop-desk parcel waiting for the customer — the
 * final mile, like `Sorti en livraison`.
 */

import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import type { CarrierStatus } from "../contract";

const progress: Interpretation = { kind: "progress" };
const outForDelivery: Interpretation = { kind: "milestone", milestone: "out_for_delivery" };
const delivered: Interpretation = { kind: "milestone", milestone: "delivered" };
const returnStarted: Interpretation = { kind: "milestone", milestone: "return_started" };
const returnToCollect: Interpretation = { kind: "milestone", milestone: "return_started", attention: true };
const returned: Interpretation = { kind: "milestone", milestone: "returned" };
const cancelled: Interpretation = { kind: "milestone", milestone: "cancelled" };

export const YALIDINE_STATUSES: Readonly<Record<string, Interpretation>> = {
  "Pas encore expédié": progress,
  "A vérifier": progress,
  "En préparation": progress,
  "Pas encore ramassé": progress,
  "Prêt à expédier": progress,
  "En passation": progress,
  "Ramassé": progress,
  "Bloqué": { kind: "exception" },
  "Débloqué": progress,
  "Transfert": progress,
  "Expédié": progress,
  "Centre": progress,
  "En localisation": progress,
  "Vers Wilaya": progress,
  "En transit": progress,
  "Reçu à Wilaya": progress,
  "En attente du client": outForDelivery,
  "Prêt pour livreur": progress,
  "Sorti en livraison": outForDelivery,
  "En attente": progress,
  "Annulé": cancelled,
  "En alerte": { kind: "exception" },
  "Alerte résolue": progress,
  "Tentative échouée": { kind: "failed_attempt" },
  "Livré": delivered,
  "Echèc livraison": returnStarted,
  "Retour vers centre": returnStarted,
  "Retourné au centre": returnStarted,
  "Retour transfert": returnStarted,
  "Retour groupé": returnStarted,
  "Retour à retirer": returnToCollect,
  "Retour non retiré": returnToCollect,
  "Colis abandonné": { kind: "exception" },
  "Retour vers vendeur": returnStarted,
  "Retourné au vendeur": returned,
  "Echange échoué": returnStarted,
};

/** Webhook events that are statuses in their own right. */
export const YALIDINE_EVENTS: Readonly<Record<string, Interpretation>> = {
  /** The parcel was deleted at Yalidine (by API or in their dashboard) before it moved. */
  parcel_deleted: cancelled,
};

const normalize = (value: string) => value.normalize("NFC").trim().toLowerCase();
const STATUS_INDEX = new Map(Object.entries(YALIDINE_STATUSES).map(([k, v]) => [normalize(k), v]));

export function interpretYalidine(status: CarrierStatus): Interpretation {
  if (status.vocabulary === "status") return STATUS_INDEX.get(normalize(status.value)) ?? { kind: "unknown" };
  if (status.vocabulary === "event") return YALIDINE_EVENTS[status.value] ?? { kind: "unknown" };
  return { kind: "unknown" };
}
