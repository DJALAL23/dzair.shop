/**
 * Where review media lives, and what a received file is. A file is prepared
 * when it arrives and kept at once, under the folder of whoever sent it — a
 * shopper's upload grant, or a staff member — before any review names it:
 *
 *   reviews/<folder>/<media>.webp     a kept photo, 1600 px at most
 *   reviews/<folder>/<media>-t.webp   its thumbnail for lists
 *   reviews/<folder>/<media>.<ext>    a kept voice note, as recorded
 *
 * Reviews written before migration 0091 keep theirs under
 * `reviews/<review>/`. A file's kind is read from its first bytes
 * (`sniffMedia`, media/keys.ts), never from the name or the declared type a
 * browser sends.
 */
import { AUDIO_TYPES, IMAGE_TYPES, extensionOf, type AudioType, type ImageType } from "../media/keys";

export const REVIEW_MEDIA_PREFIX = "reviews/";

const ID = /^[a-f0-9]{32}$/;
const THUMB_SUFFIX = "-t.webp";

export function newMediaId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function isMediaId(value: string): boolean {
  return ID.test(value);
}

/** A shopper's files sit under their grant's id; a staff member's under `staff-<user>`. */
export function staffFolder(userId: string): string {
  return `staff-${userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}`;
}

export function folderPrefix(folder: string): string {
  return `${REVIEW_MEDIA_PREFIX}${folder}/`;
}

export function isThumbKey(key: string): boolean {
  return key.endsWith(THUMB_SUFFIX);
}

export function photoKeys(folder: string, mediaId: string): { key: string; thumbKey: string } {
  return { key: `${folderPrefix(folder)}${mediaId}.webp`, thumbKey: `${folderPrefix(folder)}${mediaId}${THUMB_SUFFIX}` };
}

export function voiceKey(folder: string, mediaId: string, contentType: VoiceContentType): string {
  return `${folderPrefix(folder)}${mediaId}.${extensionOf(contentType)}`;
}

/** Every key an upload of `mediaId` can have kept: its photo and thumbnail, or its voice note. */
export function uploadKeys(folder: string, mediaId: string): string[] {
  const { key, thumbKey } = photoKeys(folder, mediaId);
  return [key, thumbKey, ...VOICE_CONTENT_TYPES.map((type) => voiceKey(folder, mediaId, type))];
}

/** The upload a kept key belongs to. */
export function mediaIdOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1).replace(/(-t)?\.[a-z0-9]+$/, "");
}

export const PHOTO_CONTENT_TYPES = IMAGE_TYPES;
export type PhotoContentType = ImageType;

export const VOICE_CONTENT_TYPES = AUDIO_TYPES;
export type VoiceContentType = AudioType;
