/**
 * A store's review policy: whether reviews are on, what a shopper may attach,
 * and what publishes without the merchant checking it — read once from the
 * store's settings, clamped to the hard limits, and asked by everyone who
 * needs it (the storefront config, the upload grant, the submission, the
 * settings screen). No caller reads the store's review columns itself.
 */
import {
  REVIEW_AUTO_PUBLISH,
  REVIEW_MAX_PHOTOS,
  REVIEW_VOICE_LENGTHS,
  type ModerationStatus,
  type ReviewAutoPublish,
  type ReviewVoiceLength,
} from "./model";

export interface ReviewPolicy {
  enabled: boolean;
  /** 0 = no photos. */
  maxPhotos: number;
  /** null = no voice notes. */
  voiceMaxSeconds: ReviewVoiceLength | null;
  autoPublish: ReviewAutoPublish;
}

/** The store columns the policy is read from. */
export interface ReviewSettings {
  reviewsEnabled: boolean;
  reviewMaxPhotos: number;
  reviewVoiceMaxSeconds: number | null;
  reviewAutoPublish: string;
}

/** What a new store starts with: photos on, no voice, text reviews published at once. */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = { enabled: true, maxPhotos: 3, voiceMaxSeconds: null, autoPublish: "text_only" };

export function reviewPolicy(settings: ReviewSettings): ReviewPolicy {
  const photos = Number.isFinite(settings.reviewMaxPhotos) ? Math.trunc(settings.reviewMaxPhotos) : DEFAULT_REVIEW_POLICY.maxPhotos;
  return {
    enabled: settings.reviewsEnabled,
    maxPhotos: Math.min(Math.max(photos, 0), REVIEW_MAX_PHOTOS),
    voiceMaxSeconds: (REVIEW_VOICE_LENGTHS as readonly number[]).includes(settings.reviewVoiceMaxSeconds ?? -1)
      ? (settings.reviewVoiceMaxSeconds as ReviewVoiceLength)
      : null,
    autoPublish: (REVIEW_AUTO_PUBLISH as readonly string[]).includes(settings.reviewAutoPublish)
      ? (settings.reviewAutoPublish as ReviewAutoPublish)
      : "off",
  };
}

/** Where a shopper's review lands once its media is in: published at once, or waiting for the merchant. */
export function statusOnArrival(policy: ReviewPolicy, review: { hasMedia: boolean }): Extract<ModerationStatus, "pending" | "approved"> {
  if (policy.autoPublish === "all") return "approved";
  if (policy.autoPublish === "text_only" && !review.hasMedia) return "approved";
  return "pending";
}

// ─── What a file may weigh ───────────────────────────────────────────────────

/**
 * A photo as it may arrive. The storefront shrinks it in the browser first
 * (to about 1600 px, a few hundred KB); this is the ceiling for a browser that
 * could not, and stays under what the image service accepts (20 MB).
 */
export const REVIEW_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A voice note as it may arrive: about 24 KB a second covers Opus and AAC at
 * the bitrates phones record speech with, plus room for the container. The
 * size is the guarantee; the recorder stops at the length, and a file's own
 * stated duration is checked when it can be read.
 */
export function voiceMaxBytes(seconds: ReviewVoiceLength): number {
  return seconds * 24 * 1024 + 64 * 1024;
}

/** A voice note may run this much past its limit (recorders stop a little late). */
export const VOICE_DURATION_TOLERANCE_MS = 5_000;

export const REVIEW_TEXT = { titleMax: 150, bodyMin: 10, bodyMax: 2000, nameMax: 80 } as const;
