/**
 * Where review media lives, and what a received file is.
 *
 *   staging/reviews/<grant>/<upload>  a file as the shopper sent it, in the
 *                                     store's Staging — the bucket's
 *                                     lifecycle rule clears `staging/` after
 *                                     a day, so an upload never submitted
 *                                     costs nothing to clean
 *   reviews/<review>/<media>.webp     a kept photo, 1600 px at most
 *   reviews/<review>/<media>-t.webp   its thumbnail for lists
 *   reviews/<review>/<media>.<ext>    a kept voice note, as recorded
 *
 * A file's kind is read from its first bytes (`sniffMedia`, media/keys.ts),
 * never from the name or the declared type a browser sends.
 */
import { AUDIO_TYPES, IMAGE_TYPES, extensionOf, type AudioType, type ImageType } from "../media/keys";

export const REVIEW_UPLOAD_PREFIX = "staging/reviews/";
export const REVIEW_MEDIA_PREFIX = "reviews/";

const ID = /^[a-f0-9]{32}$/;

export function newMediaId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function isMediaId(value: string): boolean {
  return ID.test(value);
}

export function uploadPrefix(grantId: string): string {
  return `${REVIEW_UPLOAD_PREFIX}${grantId}/`;
}

export function uploadKey(grantId: string, uploadId: string): string {
  return `${uploadPrefix(grantId)}${uploadId}`;
}

export function photoKeys(reviewId: string, mediaId: string): { key: string; thumbKey: string } {
  return { key: `${REVIEW_MEDIA_PREFIX}${reviewId}/${mediaId}.webp`, thumbKey: `${REVIEW_MEDIA_PREFIX}${reviewId}/${mediaId}-t.webp` };
}

export function voiceKey(reviewId: string, mediaId: string, contentType: VoiceContentType): string {
  return `${REVIEW_MEDIA_PREFIX}${reviewId}/${mediaId}.${extensionOf(contentType)}`;
}

export const PHOTO_CONTENT_TYPES = IMAGE_TYPES;
export type PhotoContentType = ImageType;

export const VOICE_CONTENT_TYPES = AUDIO_TYPES;
export type VoiceContentType = AudioType;
