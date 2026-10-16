/**
 * Where review media lives in R2, and what a received file is.
 *
 *   review-uploads/<grant>/<upload>   a file as the shopper sent it — the
 *                                     bucket's lifecycle rule deletes this
 *                                     prefix after a day, so an upload never
 *                                     submitted costs nothing to clean
 *   reviews/<review>/<media>.webp     a kept photo, 1600 px at most
 *   reviews/<review>/<media>-t.webp   its thumbnail for lists
 *   reviews/<review>/<media>.<ext>    a kept voice note, as recorded
 *
 * A file's kind is read from its first bytes, never from the name or the
 * declared type a browser sends.
 */
import type { ReviewMediaKind } from "./model";

export const REVIEW_UPLOAD_PREFIX = "review-uploads/";
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
  return `${REVIEW_MEDIA_PREFIX}${reviewId}/${mediaId}.${VOICE_EXTENSIONS[contentType]}`;
}

export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

/** What phones record speech in (WebM/Opus on Android, MP4/AAC on iPhone) and what people send as files. */
export const VOICE_CONTENT_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"] as const;
export type VoiceContentType = (typeof VOICE_CONTENT_TYPES)[number];

const VOICE_EXTENSIONS: Record<VoiceContentType, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

export interface SniffedMedia {
  kind: ReviewMediaKind;
  contentType: PhotoContentType | VoiceContentType;
}

const startsWith = (bytes: Uint8Array, at: number, ...values: number[]) => values.every((value, i) => bytes[at + i] === value);
const ascii = (bytes: Uint8Array, at: number, text: string) => startsWith(bytes, at, ...Array.from(text, (c) => c.charCodeAt(0)));

/** A photo or a voice note, from the file's first 16 bytes; null for anything else. */
export function sniffMedia(head: Uint8Array): SniffedMedia | null {
  if (startsWith(head, 0, 0xff, 0xd8, 0xff)) return { kind: "image", contentType: "image/jpeg" };
  if (startsWith(head, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: "image", contentType: "image/png" };
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return { kind: "image", contentType: "image/webp" };
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return { kind: "image", contentType: "image/gif" };
  if (startsWith(head, 0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: "audio", contentType: "audio/webm" };
  if (ascii(head, 0, "OggS")) return { kind: "audio", contentType: "audio/ogg" };
  if (ascii(head, 4, "ftyp")) return { kind: "audio", contentType: "audio/mp4" };
  if (ascii(head, 0, "ID3")) return { kind: "audio", contentType: "audio/mpeg" };
  if (head[0] === 0xff && head[1] !== undefined && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0) return { kind: "audio", contentType: "audio/mpeg" };
  return null;
}
