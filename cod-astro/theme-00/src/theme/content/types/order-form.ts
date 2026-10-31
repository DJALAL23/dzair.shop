/**
 * Content pack types - order-form (split from types.ts).
 *
 * Groups: order-form.
 */

export type OrderFormStrings = {
  orderCta: string;
  orderCtaSubtext: string;
  formTitle: string;
  formDeliverySection: string;
  formNameLabel: string;
  formPhoneLabel: string;
  formPhoneInvalid: string;
  formWilayaLabel: string;
  formCommuneLabel: string;
  formCommunePlaceholder: string;
  formCommuneLoading: string;
  formCommuneDisabled: string;
  formAddressLabel: string;
  formAddressPlaceholder: string;
  formDeliveryLabel: string;
  formHomeDelivery: string;
  formStopDesk: string;
  formNotesLabel: string;
  formNotesPlaceholder: string;
  /** Email row — rendered only when the merchant enables the field. */
  formEmailLabel: string;
  formEmailPlaceholder: string;
  /** Shown under a required dropdown the shopper submitted without answering. */
  formRequiredField: string;
  /** Shown above the form when the store refuses an order the shopper cannot fix here. */
  formSubmitFailed: string;
  /** Under a field the server refused for a reason the shopper can fix by checking it. */
  formFieldInvalid: string;
  formSubmit: string;
  formConfirmNote: string;
};
