/**
 * What ZR Express states mean to CodFlow.
 *
 * ZR states are per-tenant workflow states, not a fixed vocabulary. The
 * defaults below are the default workflow ("New Delivery Workflow"), captured
 * live on 2026-09-10 via `POST /workflows/search` — slugs as `state.name`,
 * French text as `state.description`. A merchant whose tenant names states
 * differently maps them in the company's settings (`statusMap`, keyed by
 * meaning); their mapping wins over these defaults.
 *
 * Matching is accent- and case-insensitive, on the slug first and then on the
 * description, because tenants that rename slugs usually keep the wording.
 *
 * `encaisse` / `recouvert` say the cash was collected: delivered, and money
 * the settlement domain will care about. `isReturn` turning true is ZR's
 * `markedAsReturnAt` — a return *starting*; the goods are only back when a
 * recovery state is reached.
 */

import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import type { CarrierStatus } from "../contract";
import { stripAccents } from "./text";
import { ZR_MAPPABLE_MEANINGS } from "../../../../cod-shared/carriers/providers";

export { ZR_MAPPABLE_MEANINGS };

export type ZrMeaning = (typeof ZR_MAPPABLE_MEANINGS)[number];
export type ZrStatusMap = Partial<Record<ZrMeaning, string[]>>;

const MEANING: Record<ZrMeaning, Interpretation> = {
  out_for_delivery: { kind: "milestone", milestone: "out_for_delivery" },
  delivered: { kind: "milestone", milestone: "delivered" },
  collection: { kind: "collection" },
  return_started: { kind: "milestone", milestone: "return_started" },
  returned: { kind: "milestone", milestone: "returned" },
  cancelled: { kind: "milestone", milestone: "cancelled" },
  failed_attempt: { kind: "failed_attempt" },
  exception: { kind: "exception" },
  progress: { kind: "progress" },
};

export const ZR_DEFAULT_STATES: Readonly<Record<string, Interpretation>> = {
  commande_recue: MEANING.progress,
  en_traitement: MEANING.progress,
  appel_confirmation: MEANING.progress,
  commande_confirmee: MEANING.progress,
  en_preparation: MEANING.progress,
  pret_a_expedier: MEANING.progress,
  confirme_au_bureau: MEANING.progress,
  confirme_chez_partenaire: MEANING.progress,
  dispatch: MEANING.progress,
  vers_wilaya: MEANING.progress,
  en_livraison: MEANING.out_for_delivery,
  sortie_en_livraison: MEANING.out_for_delivery,
  livre: MEANING.delivered,
  "livre au client": MEANING.delivered,
  encaisse: MEANING.collection,
  recouvert: MEANING.collection,
  retour_sous_traitant: MEANING.return_started,
  attente_recuperation_fournisseur: { kind: "milestone", milestone: "return_started", attention: true },
  colis_recupere: MEANING.returned,
  recupere_par_fournisseur: MEANING.returned,
  reinjecte_dans_stock: MEANING.returned,
  // Earlier tenants' English names.
  "in transit": MEANING.progress,
  "at hub": MEANING.progress,
  "out for delivery": MEANING.out_for_delivery,
};

/** ZR events that are statuses in their own right. */
const ZR_EVENTS: Readonly<Record<string, Interpretation>> = {
  "isReturn:true": MEANING.return_started,
};

const key = (value: string) => stripAccents(value).toLowerCase().trim();
const DEFAULT_INDEX = new Map(Object.entries(ZR_DEFAULT_STATES).map(([k, v]) => [key(k), v]));

function tenantIndex(statusMap: ZrStatusMap | undefined): Map<string, Interpretation> {
  const index = new Map<string, Interpretation>();
  for (const meaning of ZR_MAPPABLE_MEANINGS) {
    for (const name of statusMap?.[meaning] ?? []) index.set(key(name), MEANING[meaning]);
  }
  return index;
}

/** An interpreter for one ZR tenant: its own mapping first, then the default workflow. */
export function zrInterpreter(statusMap?: ZrStatusMap): (status: CarrierStatus) => Interpretation {
  const tenant = tenantIndex(statusMap);
  const lookup = (text: string | null | undefined) =>
    text ? tenant.get(key(text)) ?? DEFAULT_INDEX.get(key(text)) : undefined;

  return (status) => {
    if (status.vocabulary === "event") return ZR_EVENTS[status.value] ?? { kind: "unknown" };
    if (status.vocabulary === "situation") return tenant.get(key(status.value)) ?? MEANING.progress;
    if (status.vocabulary !== "state") return { kind: "unknown" };
    return lookup(status.value) ?? lookup(status.label) ?? { kind: "unknown" };
  };
}
