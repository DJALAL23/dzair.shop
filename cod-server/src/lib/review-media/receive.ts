/**
 * Receiving one review file — a shopper's under their grant, or a merchant's
 * for a review they enter: read while counting (never past the limit), typed
 * by its bytes, checked against what may be attached, prepared, and kept at
 * once by the Media Library on the store's host, under `reviews/<folder>/`
 * (reviews/media.ts). Nothing waits anywhere first.
 *
 *   a photo       becomes WebP at 1600 px and a 480 px thumbnail — the
 *                 conversion drops its EXIF, so a phone's location never
 *                 leaves our hands, and a photo is never kept unconverted
 *   a voice note  is measured, refused when longer than allowed, and kept as
 *                 recorded with its length
 *
 * A file that can never be kept is refused; a passing failure throws, and
 * the browser sends the file again.
 */
import type { AppDb } from "@/db";
import { BusinessLogicError, ValidationError } from "@/lib/errors/classes";
import { parseImageDimensions } from "@/lib/image-dimensions";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import type { MediaLibrary } from "../../../../cod-shared/media/library";
import { sniffMedia } from "../../../../cod-shared/media/keys";
import { readCapped } from "../../../../cod-shared/media/stream";
import { waitingUploads } from "../../../../cod-shared/queries/review-uploads";
import { newMediaId, photoKeys, voiceKey, type VoiceContentType } from "../../../../cod-shared/reviews/media";
import type { ReviewMediaKind, ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import { REVIEW_PHOTO_MAX_BYTES, VOICE_DURATION_TOLERANCE_MS, voiceMaxBytes } from "../../../../cod-shared/reviews/policy";
import { audioDurationMs } from "./audio-duration";

export const PHOTO_EDGE = 1600;
export const THUMB_EDGE = 480;
const PHOTO_QUALITY = 80;
const THUMB_QUALITY = 75;

export interface FileAllowance {
  /** 0 = no photos. */
  maxPhotos: number;
  /** null = no voice note. */
  voiceMaxSeconds: number | null;
}

export interface ReceivedFile {
  uploadId: string;
  kind: ReviewMediaKind;
  bytes: number;
}

export interface ReceiveDeps {
  db: AppDb;
  media: MediaLibrary;
  /** The Images binding: without it, no photo can be kept. */
  images?: ImagesBinding;
}

/** Images errors 9400–9499 are about the input (not an image, too large, too many pixels): retrying cannot help. */
function isBadImage(error: unknown): boolean {
  const code = Number((error as { code?: unknown })?.code);
  return code >= 9400 && code < 9500;
}

async function toWebp(images: ImagesBinding, bytes: Uint8Array<ArrayBuffer>, edge: number, quality: number): Promise<Uint8Array<ArrayBuffer>> {
  const result = await images
    .input(new Blob([bytes]).stream())
    .transform({ width: edge, height: edge, fit: "scale-down" })
    .output({ format: "image/webp", quality });
  const response = result.response();
  if (!response.ok) throw new Error(`image service answered HTTP ${response.status}`);
  const webp = new Uint8Array(await response.arrayBuffer());
  if (webp.byteLength === 0) throw new Error("image service returned an empty file");
  return webp;
}

async function keepPhoto(deps: ReceiveDeps & { images: ImagesBinding }, folder: string, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  let full: Uint8Array<ArrayBuffer>;
  let thumb: Uint8Array<ArrayBuffer>;
  try {
    full = await toWebp(deps.images, bytes, PHOTO_EDGE, PHOTO_QUALITY);
    thumb = await toWebp(deps.images, bytes, THUMB_EDGE, THUMB_QUALITY);
  } catch (error) {
    if (isBadImage(error)) throw new ValidationError("This photo cannot be read — send another one", ERROR_CODES.INVALID_FILE_TYPE);
    throw error;
  }
  const { key, thumbKey } = photoKeys(folder, id);
  const size = parseImageDimensions(full);
  const thumbSize = parseImageDimensions(thumb);
  await deps.media.store({ key: thumbKey, contentType: "image/webp", body: thumb, width: thumbSize?.width ?? null, height: thumbSize?.height ?? null });
  await deps.media.store({ key, contentType: "image/webp", body: full, width: size?.width ?? null, height: size?.height ?? null });
}

async function keepVoice(deps: ReceiveDeps, folder: string, id: string, bytes: Uint8Array<ArrayBuffer>, contentType: VoiceContentType, maxSeconds: number, declaredMs: number | undefined): Promise<void> {
  const measured = audioDurationMs(bytes, contentType);
  if (measured !== null && measured > maxSeconds * 1000 + VOICE_DURATION_TOLERANCE_MS) {
    throw new ValidationError(`A voice note is at most ${maxSeconds} seconds`, ERROR_CODES.FILE_TOO_LARGE, { maxSeconds });
  }
  const durationMs = measured ?? (declaredMs !== undefined ? Math.min(declaredMs, maxSeconds * 1000) : null);
  await deps.media.store({ key: voiceKey(folder, id, contentType), contentType, body: bytes, durationMs });
}

export async function receiveFile(
  deps: ReceiveDeps,
  input: {
    folder: string;
    body: ReadableStream<Uint8Array> | null;
    declaredBytes?: number;
    declaredDurationMs?: number;
    allowance: FileAllowance;
    /** How many files of each kind the folder may hold before a review shows them (a shopper may re-send one they removed). */
    folderLimit: Record<ReviewMediaKind, number>;
  },
): Promise<ReceivedFile> {
  const { allowance } = input;
  const voiceCap = allowance.voiceMaxSeconds ? voiceMaxBytes(allowance.voiceMaxSeconds as ReviewVoiceLength) : 0;
  const photoCap = allowance.maxPhotos > 0 ? REVIEW_PHOTO_MAX_BYTES : 0;
  const cap = Math.max(voiceCap, photoCap);
  const tooLarge = () => new ValidationError("This file is too large", ERROR_CODES.FILE_TOO_LARGE, { maxBytes: cap });
  if (!input.body) throw new ValidationError("No file was sent", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  if (input.declaredBytes !== undefined && input.declaredBytes > cap) throw tooLarge();

  const bytes = await readCapped(input.body, cap);
  if (!bytes) throw tooLarge();
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  const sniffed = sniffMedia(bytes.subarray(0, 16));
  if (!sniffed) throw new ValidationError("Send a photo (JPEG, PNG, WebP) or a voice note (WebM, Ogg, M4A, MP3)", ERROR_CODES.INVALID_FILE_TYPE);

  const allowed = sniffed.kind === "image" ? allowance.maxPhotos > 0 && deps.images !== undefined : allowance.voiceMaxSeconds !== null;
  if (!allowed) {
    throw new BusinessLogicError(sniffed.kind === "image" ? "Photos are not taken with these reviews" : "Voice notes are not taken with these reviews", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max: 0 });
  }
  if (bytes.byteLength > (sniffed.kind === "image" ? photoCap : voiceCap)) throw tooLarge();

  const waiting = await waitingUploads(deps.db, input.folder);
  const max = input.folderLimit[sniffed.kind];
  if (waiting[sniffed.kind] >= max) throw new BusinessLogicError("Too many files sent for this review", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max });

  const uploadId = newMediaId();
  if (sniffed.kind === "image") await keepPhoto({ ...deps, images: deps.images! }, input.folder, uploadId, bytes);
  else await keepVoice(deps, input.folder, uploadId, bytes, sniffed.contentType as VoiceContentType, allowance.voiceMaxSeconds!, input.declaredDurationMs);
  return { uploadId, kind: sniffed.kind, bytes: bytes.byteLength };
}
