/**
 * French (fr) - order-form.
 */

import type { OrderFormStrings } from "../types/order-form";

export const frOrderForm: OrderFormStrings = {
  orderCta: "Commander maintenant",
  orderCtaSubtext: "Paiement à la livraison",
  formTitle: "Complétez votre commande",
  formDeliverySection: "Informations de livraison",
  formNameLabel: "Nom complet",
  formPhoneLabel: "Numéro de téléphone",
  formPhoneInvalid: "Numéro algérien invalide — doit commencer par 05, 06 ou 07",
  formWilayaLabel: "Wilaya",
  formCommuneLabel: "Commune",
  formCommunePlaceholder: "Choisissez la commune",
  formCommuneLoading: "Chargement...",
  formCommuneDisabled: "Choisissez d'abord la wilaya",
  formAddressLabel: "Adresse détaillée",
  formAddressPlaceholder: "Rue, quartier, numéro de bâtiment...",
  formDeliveryLabel: "Mode de livraison",
  formHomeDelivery: "Livraison à domicile",
  formStopDesk: "Retrait au bureau",
  formNotesLabel: "Notes",
  formNotesPlaceholder: "Détails supplémentaires pour la livraison...",
  formEmailLabel: "E-mail",
  formEmailPlaceholder: "vous@exemple.com",
  formRequiredField: "Veuillez choisir une option",
  formSubmitFailed: "Votre commande n'a pas pu être enregistrée. Réessayez, ou contactez la boutique.",
  formFieldInvalid: "Vérifiez ce champ",
  formSubmitFailedReference: "Votre commande n'a pas pu être enregistrée. Réessayez, ou contactez la boutique avec cette référence : {reference}",
  formFixFields: "Corrigez les informations signalées, puis confirmez.",
  formOutOfStock: "Ce produit n'est pas disponible dans la quantité demandée. Réduisez la quantité ou choisissez une autre option.",
  formOutOfStockNamed: "« {product} » n'est pas disponible dans la quantité demandée. Réduisez la quantité ou choisissez une autre option.",
  formProductUnavailable: "Ce produit n'est plus disponible à la commande.",
  formProductUnavailableNamed: "« {product} » n'est plus disponible à la commande.",
  formDeliveryUnavailable: "La livraison n'est pas disponible ainsi à cette adresse. Choisissez un autre mode de livraison ou une autre adresse.",
  formBotCheckFailed: "La vérification de sécurité n'a pas abouti. Patientez un instant, puis confirmez à nouveau.",
  formPhoneNotVerified: "Votre numéro n'a pas pu être vérifié. Vérifiez-le à nouveau pour commander.",
  formSubmit: "Confirmer la commande",
  formConfirmNote: "Notre équipe vous contactera pour confirmer votre commande dans les 24 heures",

};
