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
  /** Shown above the form when the order could not be sent and nothing in it is to blame. */
  formSubmitFailed: string;
  /** The same, with the reference the shopper can quote to the store: `{reference}`. */
  formSubmitFailedReference: string;
  /** Under a field the server refused for a reason the shopper can fix by checking it. */
  formFieldInvalid: string;
  /** Above the form when fields are marked to fix. */
  formFixFields: string;
  /** A product is not available in the quantity asked; the named form takes `{product}`. */
  formOutOfStock: string;
  formOutOfStockNamed: string;
  /** A product can no longer be ordered; the named form takes `{product}`. */
  formProductUnavailable: string;
  formProductUnavailableNamed: string;
  /** The store does not deliver this way to this place. */
  formDeliveryUnavailable: string;
  /** The bot check did not finish or expired. */
  formBotCheckFailed: string;
  /** The phone code is missing, wrong or expired. */
  formPhoneNotVerified: string;
  formSubmit: string;
  formConfirmNote: string;
};
