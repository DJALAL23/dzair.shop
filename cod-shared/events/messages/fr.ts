import type { MessageLanguage } from "./language";
import { storeTime } from "./time";

const calls = (count: number) => (count <= 1 ? `${count} appel` : `${count} appels`);

export const fr: MessageLanguage = {
  locale: "fr",
  numbers: "fr",
  currency: "DA",
  headline: {
    "order.created": (e) => `🛒 Nouvelle commande n° ${e.data.order.number}`,
    "order.updated": (e) => `✏️ La commande n° ${e.data.order.number} a été modifiée`,
    "order.confirmed": (e) => `✅ Commande n° ${e.data.order.number} confirmée`,
    "order.unreachable": (e) =>
      e.data.order.unansweredCalls > 0
        ? `📵 Injoignable · Appel ${e.data.order.unansweredCalls} — commande n° ${e.data.order.number}`
        : e.data.previousStatus === "unreachable"
          ? `📵 Toujours pas de réponse du client de la commande n° ${e.data.order.number}`
          : `📵 Le client de la commande n° ${e.data.order.number} est injoignable`,
    "order.preparing": (e) => `📦 La commande n° ${e.data.order.number} est en préparation`,
    "order.ready": (e) => `📦 La commande n° ${e.data.order.number} est prête à expédier`,
    "order.cancelled": (e) =>
      e.data.previousStatus === "unreachable" && e.data.order.unansweredCalls > 0
        ? `❌ Commande n° ${e.data.order.number} annulée après ${calls(e.data.order.unansweredCalls)} sans réponse`
        : `❌ Commande n° ${e.data.order.number} annulée`,
    "order.line_returned": (e) => `↩️ Des articles de la commande n° ${e.data.order.number} ont été refusés à la livraison`,
    "order.deleted": (e) => `🗑️ Commande n° ${e.data.order.number} supprimée`,
    "order.assigned": (e) =>
      e.data.way === "take_back" && e.data.previousAssignee
        ? `⏱️ La commande n° ${e.data.order.number} passe de ${e.data.previousAssignee.name} à ${e.data.assignee.name} : non traitée à temps`
        : `👤 La commande n° ${e.data.order.number} est confiée à ${e.data.assignee.name}`,
    "order.unassigned": (e) => `👤 La commande n° ${e.data.order.number} n'est plus confiée à personne`,
    "order.callback_scheduled": (e) =>
      e.data.previousAt
        ? `⏰ Rappel de la commande n° ${e.data.order.number} déplacé au ${storeTime("fr", e.data.at)}`
        : `⏰ Rappeler le client de la commande n° ${e.data.order.number} : ${storeTime("fr", e.data.at)}`,
    "order.callback_cleared": (e) => `🔕 Plus de rappel prévu pour la commande n° ${e.data.order.number}`,
    "order.callback_due": (e) => `⏰ C'est l'heure de rappeler le client de la commande n° ${e.data.order.number}`,
    "shipment.handed_off": (e) => `🚚 La commande n° ${e.data.order.number} a été remise à la livraison`,
    "shipment.out_for_delivery": (e) => `🛵 La commande n° ${e.data.order.number} est en cours de livraison`,
    "shipment.delivery_failed": (e) => `⚠️ La tentative de livraison ${e.data.attempt} de la commande n° ${e.data.order.number} a échoué`,
    "shipment.delivered": (e) => `🎉 Commande n° ${e.data.order.number} livrée`,
    "shipment.return_started": (e) => `↩️ La commande n° ${e.data.order.number} est en retour`,
    "shipment.returned": (e) => `📥 La commande n° ${e.data.order.number} est revenue à la boutique`,
    "shipment.cancelled": (e) => `❌ L'expédition de la commande n° ${e.data.order.number} a été annulée`,
    "shipment.voided": (e) => `⏪ La remise à la livraison de la commande n° ${e.data.order.number} a été annulée`,
    "review.submitted": (e) => `⭐ Nouvel avis, ${e.data.review.rating}/5 — commande n° ${e.data.order.number}`,
  },
  words: {
    total: "Total",
    toCollect: "À encaisser",
    carrier: "Transporteur",
    driver: "Livreur",
    tracking: "Suivi",
    reason: "Motif",
    by: "Par",
    changed: "Modifié",
    refused: "Refusé",
    home: "livraison à domicile",
    stopDesk: "retrait au bureau",
    assignee: "Confiée à",
    callbackWas: "Il était prévu le",
    voiceNote: "note vocale",
    reviewPublished: "Publié sur votre boutique",
    reviewPending: "En attente de votre validation",
  },
  fields: {
    customerName: "nom du client",
    customerPhone: "téléphone",
    customerEmail: "e-mail",
    destination: "adresse",
    notes: "notes",
  },
  connected: "✅ Connecté. Cette discussion recevra désormais les notifications de votre boutique.",
  test: "🔔 Message de test : votre boutique peut joindre cette discussion.",
  pairingRefused: "Ce lien ne peut plus connecter de discussion. Ouvrez-en un nouveau depuis la page de l'app Telegram de votre boutique.",
};
