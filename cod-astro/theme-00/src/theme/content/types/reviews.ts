/**
 * Content pack types - reviews (split from types.ts).
 *
 * Groups: reviews.
 */

import type { Plural } from "./plural";

export type ReviewsStrings = Plural<"reviewFormPhotosHint"> & Plural<"reviewFormVoiceHint"> & Plural<"reviewFormErrorTooManyPhotos"> & {
  reviewsTitle: string;
  /** Under the title while a product has no review yet. */
  reviewsEmpty: string;
  reviewsVerifiedBuyer: string;
  reviewFormTitle: string;
  reviewFormOrderLabel: string;
  reviewFormOrderPlaceholder: string;
  reviewFormOrderHelp: string;
  reviewFormRatingLabel: string;
  reviewFormTitleLabel: string;
  reviewFormTitlePlaceholder: string;
  reviewFormBodyLabel: string;
  reviewFormBodyPlaceholder: string;
  reviewFormSubmit: string;
  reviewFormSuccess: string;
  reviewFormErrorDuplicate: string;
  reviewFormErrorInvalidOrder: string;
  reviewFormErrorGeneric: string;
  /** A review's voice note, for screen readers and the player's label. */
  reviewsVoiceNote: string;
  /** The voice note's own controls: play, pause and the position track. */
  reviewsPlayVoice: string;
  reviewsPauseVoice: string;
  reviewsSeekVoice: string;
  /** "{elapsed}", "{total}": where the note is, as a screen reader says it. */
  reviewsVoicePosition: string;
  /** The note could not be played; its button then retries. */
  reviewsVoiceError: string;
  reviewsVoiceRetry: string;
  /** "{index}": which photo. */
  reviewsOpenPhoto: string;
  reviewsClosePhoto: string;
  /** The review form's dialog: its close button. */
  reviewFormClose: string;
  reviewFormIntro: string;
  reviewFormPhoneLabel: string;
  reviewFormPhonePlaceholder: string;
  reviewFormPhoneHelp: string;
  reviewFormFind: string;
  /** "{order}": the order number found. */
  reviewFormOrderFound: string;
  reviewFormChangeOrder: string;
  reviewFormProductLabel: string;
  reviewFormAlreadyReviewed: string;
  reviewFormNothingLeft: string;
  reviewFormBodyVoiceHint: string;
  reviewFormPhotosLabel: string;
  reviewFormPhotosAdd: string;
  reviewFormVoiceLabel: string;
  reviewFormVoiceRecord: string;
  reviewFormVoiceStop: string;
  reviewFormVoiceRecording: string;
  reviewFormVoiceAttach: string;
  reviewFormVoiceDenied: string;
  reviewFormRemoveFile: string;
  reviewFormRetryFile: string;
  reviewFormSending: string;
  reviewFormNotSent: string;
  reviewFormWaitUploads: string;
  reviewFormSuccessPublished: string;
  reviewFormErrorNotDelivered: string;
  reviewFormErrorRateLimited: string;
  reviewFormErrorFileType: string;
  reviewFormErrorFileTooLarge: string;
  /** What was typed is not an order number. */
  reviewFormErrorOrderFormat: string;
  reviewFormErrorDisabled: string;
  /** The product chosen is not one the order holds. */
  reviewFormErrorProduct: string;
  /** The time to send files has run out: the shopper finds the order again. */
  reviewFormErrorGrant: string;
  /** A file the review names never arrived. */
  reviewFormErrorUploadMissing: string;
  /** More photos or voice notes than the store takes. */
  reviewFormErrorMediaLimit: string;
};
