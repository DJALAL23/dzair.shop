/**
 * The one rule for Media Keys and the files a store keeps: which folders,
 * which types, how large a browser's upload may be, and what a file is,
 * read from its bytes.
 */
import type { MediaKind } from "./model";

export const MEDIA_FOLDERS = ["products", "landing", "reviews"] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

/** The folders a browser uploads into by Upload Ticket; `reviews/` is written by the server alone. */
export const UPLOAD_FOLDERS = ["products", "landing"] as const satisfies readonly MediaFolder[];
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** What phones record speech in (WebM/Opus on Android, MP4/AAC on iPhone) and what people send as files. */
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

export type MediaType = ImageType | AudioType;

const EXTENSIONS: Record<MediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

/** The largest file a browser uploads by ticket. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** How long an Upload Ticket is good for. */
export const UPLOAD_TICKET_SECONDS = 600;

/** Every stored file is immutable: a key is never reused for other bytes. */
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

const MAX_KEY_LENGTH = 512;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isMediaType(value: unknown): value is MediaType {
  return typeof value === "string" && Object.hasOwn(EXTENSIONS, value);
}

export function isImageType(value: unknown): value is ImageType {
  return (IMAGE_TYPES as readonly unknown[]).includes(value);
}

export function mediaKindOf(contentType: MediaType): MediaKind {
  return contentType.startsWith("image/") ? "image" : "audio";
}

export function extensionOf(contentType: MediaType): string {
  return EXTENSIONS[contentType];
}

export function isUploadFolder(value: unknown): value is UploadFolder {
  return (UPLOAD_FOLDERS as readonly unknown[]).includes(value);
}

/** A fresh key for a browser's upload: `<folder>/<32 hex>.<ext>`. */
export function newMediaKey(folder: UploadFolder, contentType: ImageType): string {
  return `${folder}/${crypto.randomUUID().replace(/-/g, "")}.${EXTENSIONS[contentType]}`;
}

/**
 * Whether `value` can be a Media Key: a store folder, then segments of
 * letters, digits, `.`, `_` and `-` that start with a letter or digit — so no
 * empty, `.` or `..` segment, no space, query, fragment or escape.
 */
/** How rich text names one of the store's images: this prefix and its key. */
export const MEDIA_REF = "media:";

/** A rich-text image source naming one of the store's images by key. */
export function isMediaRef(value: string): boolean {
  return value.startsWith(MEDIA_REF) && isMediaKey(value.slice(MEDIA_REF.length));
}

export function isMediaKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_KEY_LENGTH) return false;
  const [folder, ...rest] = value.split("/");
  return (MEDIA_FOLDERS as readonly string[]).includes(folder!) && rest.length > 0 && rest.every((segment) => SEGMENT.test(segment));
}

export interface SniffedMedia {
  kind: MediaKind;
  contentType: MediaType;
}

const startsWith = (bytes: Uint8Array, at: number, ...values: number[]) => values.every((value, i) => bytes[at + i] === value);
const ascii = (bytes: Uint8Array, at: number, text: string) => startsWith(bytes, at, ...Array.from(text, (c) => c.charCodeAt(0)));

/** A photo or a voice note, from the file's first 16 bytes; null for anything else. Never from a name or a declared type. */
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
