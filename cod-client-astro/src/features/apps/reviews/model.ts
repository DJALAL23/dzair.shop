import { REVIEW_MAX_PHOTOS, type ReviewVoiceLength } from "../../../../../cod-shared/reviews/model";
import type { ReviewRules } from "./types";

/** What a shopper may send with a review, as the merchant chooses it. */
export const SHOPPER_REVIEW_MEDIA = ["text", "photos", "voice", "photos_voice"] as const;
export type ShopperReviewMedia = (typeof SHOPPER_REVIEW_MEDIA)[number];

export function shopperReviewMedia(rules: Pick<ReviewRules, "maxPhotos" | "voiceMaxSeconds">): ShopperReviewMedia {
  const photos = rules.maxPhotos > 0;
  const voice = rules.voiceMaxSeconds !== null;
  return photos && voice ? "photos_voice" : photos ? "photos" : voice ? "voice" : "text";
}

/** The rules a choice saves: photos and voice length kept only when the choice takes them. */
export function reviewMediaRules(
  choice: ShopperReviewMedia,
  photos: number,
  voiceSeconds: ReviewVoiceLength,
): Pick<ReviewRules, "maxPhotos" | "voiceMaxSeconds"> {
  return {
    maxPhotos: choice === "photos" || choice === "photos_voice" ? Math.min(Math.max(Math.trunc(photos), 1), REVIEW_MAX_PHOTOS) : 0,
    voiceMaxSeconds: choice === "voice" || choice === "photos_voice" ? voiceSeconds : null,
  };
}
