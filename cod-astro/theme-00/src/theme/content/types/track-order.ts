/**
 * Content pack types - following an order (the track-order page).
 */

import type { Plural } from "./plural";

/** `trackRateLimited`: too many tries, try again in {count} minutes. */
export type TrackOrderStrings = Plural<"trackRateLimited"> & {
  /** The page and the footer link. */
  trackTitle: string;
  trackIntro: string;
  trackNumberLabel: string;
  /** Where the number is, with an example ({example}). */
  trackNumberHint: string;
  trackPhoneLabel: string;
  trackSubmit: string;
  /** The form came back without both fields. */
  trackMissing: string;
  /** What was typed is not an order number ({example}). */
  trackInvalidNumber: string;
  trackInvalidPhone: string;
  /** No order has that number and phone; never says which is wrong. */
  trackNotFound: string;
  /** Too many tries, the wait unknown. */
  trackRateLimitedSoon: string;
  trackFailed: string;
  /** {date}. */
  trackPlacedOn: string;
  /** The journey list, for assistive tech. */
  trackProgress: string;
  trackDeliveryLabel: string;
  trackDeliveryHome: string;
  trackDeliveryStopDesk: string;
  trackItemsTitle: string;
  trackTotalLabel: string;
  trackTrackingLabel: string;
  trackContact: string;
  /** The WhatsApp message the contact button starts: {store}, {order}. */
  trackWhatsAppPrefill: string;
  trackAnother: string;
  trackStagePlaced: string;
  trackStagePlacedHint: string;
  trackStageConfirmed: string;
  trackStageConfirmedHint: string;
  trackStagePreparing: string;
  trackStagePreparingHint: string;
  trackStageShipped: string;
  trackStageShippedHint: string;
  trackStageOutForDelivery: string;
  trackStageOutForDeliveryHint: string;
  trackStageDelivered: string;
  trackStageDeliveredHint: string;
  trackStageReturned: string;
  trackStageReturnedHint: string;
  trackStageCancelled: string;
  trackStageCancelledHint: string;
  /** A step a newer server names. */
  trackStageOther: string;
  trackStageOtherHint: string;
};
