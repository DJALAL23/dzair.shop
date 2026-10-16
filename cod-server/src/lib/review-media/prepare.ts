/**
 * Preparing a review's files, one at a time, after the shopper was answered
 * (CodReviewMediaWorkflow runs these as its steps).
 *
 *   prepareUpload   a photo becomes WebP at 1600 px and a 480 px thumbnail —
 *                   the conversion drops its EXIF, so a phone's location never
 *                   leaves our hands, and a photo is never kept unconverted;
 *                   a voice note is checked (kind, weight, length) and kept as
 *                   recorded. A file that can never be kept is dropped; a
 *                   passing failure throws, to be retried.
 *   attachMedia     records what was kept and lands the review — published or
 *                   waiting — once; if the review is gone meanwhile, its files
 *                   go too
 *   clearUploads    removes the files as sent
 *
 * Every step can run again: a kept file's key comes from its upload's id, and
 * its row is written once.
 */
import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { parseImageDimensions } from "@/lib/image-dimensions";
import { audioDurationMs } from "./audio-duration";
import type { ReviewMediaJob, ReviewMediaUpload } from "./job";
import { reviewMedia, reviews } from "../../../../cod-shared/db/schema";
import { photoKeys, sniffMedia, voiceKey, type VoiceContentType } from "../../../../cod-shared/reviews/media";
import { REVIEW_PHOTO_MAX_BYTES, VOICE_DURATION_TOLERANCE_MS, voiceMaxBytes } from "../../../../cod-shared/reviews/policy";
import type { ReviewMediaKind, ReviewVoiceLength } from "../../../../cod-shared/reviews/model";

export const PHOTO_EDGE = 1600;
export const THUMB_EDGE = 480;
const PHOTO_QUALITY = 80;
const THUMB_QUALITY = 75;
const IMMUTABLE = "public, max-age=31536000, immutable";

export interface KeptMedia {
  id: string;
  kind: ReviewMediaKind;
  r2Key: string;
  thumbKey: string | null;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export type DropReason = "missing" | "unreadable" | "too_large" | "too_long" | "not_allowed" | "no_image_service" | "failed";
export type PreparedUpload = { kept: true; media: KeptMedia } | { kept: false; reason: DropReason };

export interface PrepareDeps {
  bucket: R2Bucket;
  images?: ImagesBinding;
}

/** Images errors 9400–9499 are about the input (not an image, too large, too many pixels): retrying cannot help. */
function isBadImage(error: unknown): boolean {
  const code = Number((error as { code?: unknown })?.code);
  return code >= 9400 && code < 9500;
}

async function toWebp(images: ImagesBinding, bytes: Uint8Array, edge: number, quality: number): Promise<Uint8Array> {
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

const mediaIdOf = (upload: ReviewMediaUpload) => upload.key.slice(upload.key.lastIndexOf("/") + 1);

async function preparePhoto(deps: PrepareDeps, reviewId: string, upload: ReviewMediaUpload, bytes: Uint8Array): Promise<PreparedUpload> {
  if (bytes.byteLength > REVIEW_PHOTO_MAX_BYTES) return { kept: false, reason: "too_large" };
  if (!deps.images) {
    console.error(`[reviews] review ${reviewId}: no image service (IMAGE_TRANSFORM) — a photo is never kept unconverted, dropped`);
    return { kept: false, reason: "no_image_service" };
  }
  let full: Uint8Array;
  let thumb: Uint8Array;
  try {
    full = await toWebp(deps.images, bytes, PHOTO_EDGE, PHOTO_QUALITY);
    thumb = await toWebp(deps.images, bytes, THUMB_EDGE, THUMB_QUALITY);
  } catch (error) {
    if (isBadImage(error)) return { kept: false, reason: "unreadable" };
    throw error;
  }
  const id = mediaIdOf(upload);
  const { key, thumbKey } = photoKeys(reviewId, id);
  const options = { httpMetadata: { contentType: "image/webp", cacheControl: IMMUTABLE } };
  await deps.bucket.put(key, full, options);
  await deps.bucket.put(thumbKey, thumb, options);
  const size = parseImageDimensions(full);
  return {
    kept: true,
    media: { id, kind: "image", r2Key: key, thumbKey, contentType: "image/webp", bytes: full.byteLength, width: size?.width ?? null, height: size?.height ?? null, durationMs: null },
  };
}

async function prepareVoice(deps: PrepareDeps, job: Pick<ReviewMediaJob, "reviewId" | "voiceMaxSeconds">, upload: ReviewMediaUpload, bytes: Uint8Array, contentType: VoiceContentType): Promise<PreparedUpload> {
  if (!job.voiceMaxSeconds) return { kept: false, reason: "not_allowed" };
  const maxSeconds = job.voiceMaxSeconds as ReviewVoiceLength;
  if (bytes.byteLength > voiceMaxBytes(maxSeconds)) return { kept: false, reason: "too_large" };
  const measured = audioDurationMs(bytes, contentType);
  if (measured !== null && measured > maxSeconds * 1000 + VOICE_DURATION_TOLERANCE_MS) return { kept: false, reason: "too_long" };
  const declared = upload.declaredDurationMs !== undefined ? Math.min(upload.declaredDurationMs, maxSeconds * 1000) : null;

  const id = mediaIdOf(upload);
  const key = voiceKey(job.reviewId, id, contentType);
  await deps.bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: IMMUTABLE } });
  return {
    kept: true,
    media: { id, kind: "audio", r2Key: key, thumbKey: null, contentType, bytes: bytes.byteLength, width: null, height: null, durationMs: measured ?? declared },
  };
}

export async function prepareUpload(deps: PrepareDeps, job: Pick<ReviewMediaJob, "reviewId" | "voiceMaxSeconds">, upload: ReviewMediaUpload): Promise<PreparedUpload> {
  const object = await deps.bucket.get(upload.key);
  if (!object) return { kept: false, reason: "missing" };
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sniffed = sniffMedia(bytes.subarray(0, 16));
  if (!sniffed) return { kept: false, reason: "unreadable" };
  if (sniffed.kind === "image") return preparePhoto(deps, job.reviewId, upload, bytes);
  return prepareVoice(deps, job, upload, bytes, sniffed.contentType as VoiceContentType);
}

/**
 * Records what was kept and lands the review, once: run again after it
 * landed, it changes nothing. "gone": the review was removed meanwhile;
 * "settled": it already landed without its files (the stuck-review sweep) —
 * either way the files kept for it are deleted instead.
 */
export async function attachMedia(db: AppDb, bucket: Pick<R2Bucket, "delete">, job: ReviewMediaJob, outcomes: PreparedUpload[]): Promise<"attached" | "gone" | "settled"> {
  const kept = outcomes.flatMap((outcome) => (outcome.kept ? [outcome.media] : []));
  const dropped = outcomes.length - kept.length;
  const review = await db.select({ id: reviews.id, status: reviews.status }).from(reviews).where(eq(reviews.id, job.reviewId)).get();
  if (review && review.status !== "processing" && kept.length > 0) {
    const attached = await db.select({ r2Key: reviewMedia.r2Key }).from(reviewMedia).where(eq(reviewMedia.reviewId, job.reviewId)).all();
    if (attached.some((row) => row.r2Key === kept[0].r2Key)) return "attached";
  }
  if (!review || review.status !== "processing") {
    const keys = kept.flatMap((media) => [media.r2Key, ...(media.thumbKey ? [media.thumbKey] : [])]);
    if (keys.length) await bucket.delete(keys);
    return review ? "settled" : "gone";
  }
  const now = new Date().toISOString();
  const rows = kept.map((media, position) => ({ ...media, reviewId: job.reviewId, position, createdAt: now }));
  const land = db
    .update(reviews)
    .set({ status: kept.length > 0 ? job.statusWithMedia : job.statusWithoutMedia, mediaDropped: dropped, updatedAt: now })
    .where(and(eq(reviews.id, job.reviewId), eq(reviews.status, "processing")));
  if (rows.length) await db.batch([db.insert(reviewMedia).values(rows).onConflictDoNothing({ target: reviewMedia.r2Key }), land]);
  else await land;
  return "attached";
}

export async function clearUploads(bucket: Pick<R2Bucket, "delete">, job: Pick<ReviewMediaJob, "uploads">): Promise<void> {
  if (job.uploads.length) await bucket.delete(job.uploads.map((upload) => upload.key));
}
