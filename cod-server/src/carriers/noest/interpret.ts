/**
 * What NOEST's tracking events mean to CodFlow.
 *
 * Source: the official "Liste des événements" (NOEST Public API v2.3, May
 * 2026, `api_documentation_v2_3.pdf` beside this file). Events are keyed by
 * `event_key`, but the documentation's own example shows events with only the
 * French `event` label, so both are recognized.
 *
 * Readings that matter for stock and money:
 *   - `return_asked_by_customer` is the merchant *asking* for a return — a
 *     request, not a parcel moving back. `return_asked_by_hub` ("Retour En
 *     transit") is the return starting.
 *   - The goods are back only at `livraison_echoue_recu` ("Retour reçu par le
 *     partenaire") or `return_validated_by_partener`; "Retour transmis au
 *     partenaire" means it is on its way to them.
 *   - `return_redispatched_to_livraison` puts a returning parcel back out for
 *     delivery — it can still end delivered.
 *   - `verssement_admin_cust` / `validation_reception_cash_by_partener` are the
 *     cash reaching the merchant: collection, implying delivered. A cancelled
 *     payout is money bookkeeping and says nothing about the parcel.
 *   - Delivery attempts come from the tracking answer's `deliveryAttempts[]`;
 *     `mise_a_jour` is also written for remarks (`add/maj`), so it is not
 *     counted as an attempt.
 *   - Pick-up and exchange events belong to order types CodFlow does not
 *     create; they are progress.
 */

import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import type { CarrierStatus } from "../contract";

const progress: Interpretation = { kind: "progress" };
const outForDelivery: Interpretation = { kind: "milestone", milestone: "out_for_delivery" };
const delivered: Interpretation = { kind: "milestone", milestone: "delivered" };
const returnStarted: Interpretation = { kind: "milestone", milestone: "return_started" };
const returned: Interpretation = { kind: "milestone", milestone: "returned" };
const collection: Interpretation = { kind: "collection" };
const exception: Interpretation = { kind: "exception" };

/** Every documented event: key → [French label, meaning]. */
export const NOEST_EVENTS: Readonly<Record<string, readonly [label: string, meaning: Interpretation]>> = {
  upload: ["Uploadé sur le système", progress],
  customer_validation: ["Validé", progress],
  validation_collect_colis: ["Colis Ramassé", progress],
  validation_reception_admin: ["Reception validé", progress],
  validation_reception: ["Enlevé par le livreur", progress],
  fdr_activated: ["En livraison", outForDelivery],
  sent_to_redispatch: ["Envoyé en redispatch", progress],
  nouvel_tentative_asked_by_customer: ["Nouvelle tentative demandée par le vendeur", progress],
  return_asked_by_customer: ["Retour demandé par le partenaire", progress],
  return_asked_by_hub: ["Retour En transit", returnStarted],
  retour_dispatched_to_partenaires: ["Retour transmis au partenaire", returnStarted],
  return_dispatched_to_partenaire: ["Retour transmis au partenaire", returnStarted],
  colis_retour_transmit_to_partner: ["Colis retour transmis au partenaire", returnStarted],
  colis_pickup_transmit_to_partner: ["Pick-UP transmis au partenaire", progress],
  annulation_dispatch_retour: ["Transmission du retour au partenaire annulée", progress],
  cancel_return_dispatched_to_partenaire: ["Annulation retour transmis", progress],
  livraison_echoue_recu: ["Retour reçu par le partenaire", returned],
  return_validated_by_partener: ["Retour validé par le partenaire", returned],
  return_redispatched_to_livraison: ["Retour remis en livraison", progress],
  return_dispatched_to_warehouse: ["Retour transmis vers entrepôt", returnStarted],
  pickedup: ["Pick-Up collecté", progress],
  valid_return_pickup: ["Pick-Up validé", progress],
  pickup_picked_recu: ["Pick-Up reçu par le partenaire", progress],
  colis_suspendu: ["Suspendu", exception],
  livre: ["Livré", delivered],
  livred: ["Livré", delivered],
  verssement_admin_cust: ["Montant transmis au partenaire", collection],
  verssement_admin_cust_canceled: ["Versement annulé", progress],
  verssement_hub_cust_canceled: ["Versement annulé", progress],
  validation_reception_cash_by_partener: ["Montant reçu par le partenaire", collection],
  echange_valide: ["Échange validé", progress],
  echange_valid_by_hub: ["Échange validé par hub", progress],
  ask_to_delete_by_admin: ["Demande de suppression", exception],
  ask_to_delete_by_hub: ["Demande de suppression", exception],
  edited_informations: ["Informations modifiées", progress],
  edit_price: ["Prix modifié", progress],
  edit_wilaya: ["Changement de wilaya", progress],
  extra_fee: ["Surfacturation du colis", progress],
  mise_a_jour: ["Tentative de livraison", progress],
};

/** The vocabulary NOEST's `deliveryAttempts[]` entries are reported in. */
export const NOEST_ATTEMPT = { vocabulary: "attempt", value: "delivery_attempt" } as const;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const BY_LABEL = new Map(Object.values(NOEST_EVENTS).map(([label, meaning]) => [fold(label), meaning]));

export function interpretNoest(status: CarrierStatus): Interpretation {
  if (status.vocabulary === NOEST_ATTEMPT.vocabulary) {
    return status.value === NOEST_ATTEMPT.value ? { kind: "failed_attempt" } : { kind: "unknown" };
  }
  if (status.vocabulary !== "event") return { kind: "unknown" };
  if (Object.hasOwn(NOEST_EVENTS, status.value)) return NOEST_EVENTS[status.value][1];
  for (const text of [status.value, status.label]) {
    const meaning = text ? BY_LABEL.get(fold(text)) : undefined;
    if (meaning) return meaning;
  }
  return { kind: "unknown" };
}
