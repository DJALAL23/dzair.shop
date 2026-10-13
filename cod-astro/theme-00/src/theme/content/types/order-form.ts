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
  formNamePlaceholder: string;
  formPhoneLabel: string;
  formPhonePlaceholder: string;
  formPhoneInvalid: string;
  formWilayaLabel: string;
  formWilayaPlaceholder: string;
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
  /**
   * The pre-order consent line. Contains exactly two tokens, `{terms}` and
   * `{refund}`, which OrderForm.astro replaces with real links to the
   * store's Terms and Refund pages (resolved by kind, from `config.pages` —
   * never a hardcoded slug). The whole sentence — word order included — is
   * this key's job, because "I agree to X" then "and Y" bolted on afterward
   * does not read naturally in every language this pack supports. The line
   * is skipped entirely when either page is not configured, never rendered
   * with a dead or missing link.
   */
  checkoutConsentText: string;
};
