/**
 * Taking in a shopper's review: everything between "find my order" and the
 * thank-you, behind three calls.
 *
 *   openReview      proves the purchase (order number + phone), says which
 *                   products can be reviewed and what may be attached, and
 *                   hands out an upload grant when the store takes media
 *   receiveUpload   stores one photo or voice note as sent, under the grant
 *   submitReview    proves the purchase again, records the review, and starts
 *                   the media job when files came with it — the shopper is
 *                   answered at once, the files are prepared after
 *
 * The store's policy is read at each call, so a setting changed meanwhile
 * applies at once. Attempts are limited per order number (a phone cannot be
 * guessed for one order); the limit is by order, not by IP, because Algerian
 * mobile networks put many shoppers behind one address.
 */
import type { AppDb } from "@/db";
import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { findReviewableOrder, getReviewPolicy, insertShopperReview, type PurchaseProof, type ReviewableProduct } from "../../../../cod-shared/queries/store-reviews";
import { settleWithoutMedia } from "../../../../cod-shared/queries/reviews";
import { REVIEW_PHOTO_MAX_BYTES, statusOnArrival, voiceMaxBytes, type ReviewPolicy } from "../../../../cod-shared/reviews/policy";
import type { ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import { isMediaId, newMediaId, sniffMedia, uploadKey, uploadPrefix } from "../../../../cod-shared/reviews/media";
import { issueUploadGrant, readUploadGrant, type UploadGrant } from "@/lib/review-media/grant";
import { reviewMediaInstanceId, type ReviewMediaJob, type ReviewMediaUpload } from "@/lib/review-media/job";

export interface IntakeDeps {
  db: AppDb;
  storeId: string;
  bucket: R2Bucket;
  workflow?: Pick<Workflow, "create">;
  uploadSecret?: string;
  limiter?: Pick<RateLimit, "limit">;
}

export interface MediaAllowance {
  maxPhotos: number;
  voiceMaxSeconds: ReviewVoiceLength | null;
}

export interface ReviewOpening {
  orderNumber: string;
  customerName: string;
  products: ReviewableProduct[];
  /** null: this review takes text only (the store's choice, or media is not set up). */
  media: (MediaAllowance & { grant: string; expiresAt: number }) | null;
}

export type Visibility = "published" | "after_review";

/** A shopper may re-send a photo they removed, so a grant takes a few more files than a review keeps. */
const UPLOAD_SLACK = 2;

async function checkPolicy(deps: IntakeDeps): Promise<ReviewPolicy> {
  const policy = await getReviewPolicy(deps.db, deps.storeId);
  if (!policy.enabled) throw new BusinessLogicError("This store does not take reviews", ERROR_CODES.REVIEWS_DISABLED);
  return policy;
}

async function limitAttempts(deps: IntakeDeps, orderNumber: string): Promise<void> {
  if (!deps.limiter) return;
  let allowed = true;
  try {
    allowed = (await deps.limiter.limit({ key: `review:${orderNumber.trim().toUpperCase()}` })).success;
  } catch {
    return;
  }
  if (!allowed) throw new BusinessLogicError("Too many attempts for this order — try again in a minute", ERROR_CODES.REVIEW_RATE_LIMITED, { windowSeconds: 60 });
}

async function proveOrder(deps: IntakeDeps, proof: PurchaseProof) {
  await limitAttempts(deps, proof.orderNumber);
  const access = await findReviewableOrder(deps.db, proof);
  if (!access.ok && access.reason === "not_delivered") {
    throw new BusinessLogicError("This order can be reviewed once it has reached you", ERROR_CODES.REVIEW_ORDER_NOT_DELIVERED);
  }
  if (!access.ok) throw new NotFoundError("Order");
  return access.order;
}

function mediaAllowed(deps: IntakeDeps, policy: ReviewPolicy): MediaAllowance | null {
  if (!deps.uploadSecret || !deps.workflow) return null;
  if (policy.maxPhotos === 0 && policy.voiceMaxSeconds === null) return null;
  return { maxPhotos: policy.maxPhotos, voiceMaxSeconds: policy.voiceMaxSeconds };
}

export async function openReview(deps: IntakeDeps, proof: { orderNumber: string; phone: string }): Promise<ReviewOpening> {
  const policy = await checkPolicy(deps);
  const order = await proveOrder(deps, proof);
  const allowance = mediaAllowed(deps, policy);
  let media: ReviewOpening["media"] = null;
  if (allowance && order.products.some((product) => !product.reviewed)) {
    const { token, grant } = await issueUploadGrant(deps.uploadSecret!, { orderId: order.id, ...allowance });
    media = { ...allowance, grant: token, expiresAt: grant.expiresAt };
  }
  return { orderNumber: order.orderNumber, customerName: order.customerName, products: order.products, media };
}

async function grantFrom(deps: IntakeDeps, token: string | undefined): Promise<UploadGrant> {
  const grant = deps.uploadSecret && token ? await readUploadGrant(deps.uploadSecret, token) : null;
  if (!grant) throw new BusinessLogicError("The upload permission is missing or has expired — find your order again", ERROR_CODES.REVIEW_UPLOAD_GRANT_INVALID);
  return grant;
}

/** Reads at most `cap` bytes; null when the body is larger. Never buffers past the cap. */
async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

export async function receiveUpload(
  deps: IntakeDeps,
  input: { grant: string | undefined; body: ReadableStream<Uint8Array> | null; declaredBytes?: number },
): Promise<{ uploadId: string; kind: ReviewMediaUpload["kind"]; bytes: number }> {
  const grant = await grantFrom(deps, input.grant);
  const voiceCap = grant.voiceMaxSeconds ? voiceMaxBytes(grant.voiceMaxSeconds as ReviewVoiceLength) : 0;
  const photoCap = grant.maxPhotos > 0 ? REVIEW_PHOTO_MAX_BYTES : 0;
  const cap = Math.max(voiceCap, photoCap);
  const tooLarge = () => new ValidationError("This file is too large", ERROR_CODES.FILE_TOO_LARGE, { maxBytes: cap });
  if (!input.body) throw new ValidationError("No file was sent", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  if (input.declaredBytes !== undefined && input.declaredBytes > cap) throw tooLarge();

  const bytes = await readCapped(input.body, cap);
  if (!bytes) throw tooLarge();
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  const sniffed = sniffMedia(bytes.subarray(0, 16));
  if (!sniffed) throw new ValidationError("Send a photo (JPEG, PNG, WebP) or a voice note (WebM, Ogg, M4A, MP3)", ERROR_CODES.INVALID_FILE_TYPE);

  const allowedKinds = { image: grant.maxPhotos > 0, audio: grant.voiceMaxSeconds !== null };
  if (!allowedKinds[sniffed.kind]) {
    throw new BusinessLogicError(sniffed.kind === "image" ? "This store does not take photos with reviews" : "This store does not take voice notes with reviews", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max: 0 });
  }
  if (bytes.byteLength > (sniffed.kind === "image" ? photoCap : voiceCap)) throw tooLarge();

  const listed = await deps.bucket.list({ prefix: uploadPrefix(grant.id), include: ["customMetadata"], limit: 100 });
  const already = listed.objects.filter((object) => object.customMetadata?.kind === sniffed.kind).length;
  const max = sniffed.kind === "image" ? grant.maxPhotos + UPLOAD_SLACK : 1 + UPLOAD_SLACK;
  if (already >= max) throw new BusinessLogicError("Too many files sent for this review", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max });

  const uploadId = newMediaId();
  await deps.bucket.put(uploadKey(grant.id, uploadId), bytes, {
    httpMetadata: { contentType: sniffed.contentType },
    customMetadata: { kind: sniffed.kind, contentType: sniffed.contentType, orderId: grant.orderId },
  });
  return { uploadId, kind: sniffed.kind, bytes: bytes.byteLength };
}

export interface ReviewSubmission {
  orderNumber: string;
  /** Absent only from `@wocart/storefront` 1.5 forms (text only). */
  phone?: string;
  productId: string;
  rating: number;
  title?: string | null;
  body: string;
  grant?: string;
  uploads?: string[];
}

async function collectUploads(deps: IntakeDeps, policy: ReviewPolicy, orderId: string, submission: ReviewSubmission): Promise<ReviewMediaUpload[]> {
  const ids = [...new Set(submission.uploads ?? [])];
  if (ids.length === 0) return [];
  const grant = await grantFrom(deps, submission.grant);
  if (grant.orderId !== orderId) throw new BusinessLogicError("The upload permission is for another order", ERROR_CODES.REVIEW_UPLOAD_GRANT_INVALID);
  if (ids.some((id) => !isMediaId(id))) throw new BusinessLogicError("A file of this review was not received", ERROR_CODES.REVIEW_UPLOAD_NOT_FOUND);

  const heads = await Promise.all(ids.map((id) => deps.bucket.head(uploadKey(grant.id, id))));
  const uploads: ReviewMediaUpload[] = [];
  for (const [i, head] of heads.entries()) {
    const kind = head?.customMetadata?.kind;
    if (!head || (kind !== "image" && kind !== "audio")) {
      throw new BusinessLogicError("A file of this review was not received — send it again", ERROR_CODES.REVIEW_UPLOAD_NOT_FOUND, { uploadId: ids[i] });
    }
    uploads.push({ key: head.key, kind, contentType: head.customMetadata?.contentType ?? head.httpMetadata?.contentType ?? "application/octet-stream", bytes: head.size });
  }
  const photos = uploads.filter((upload) => upload.kind === "image").length;
  const voices = uploads.length - photos;
  if (photos > policy.maxPhotos) throw new BusinessLogicError(`At most ${policy.maxPhotos} photos`, ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: "image", max: policy.maxPhotos });
  if (voices > (policy.voiceMaxSeconds ? 1 : 0)) {
    throw new BusinessLogicError("At most one voice note", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: "audio", max: policy.voiceMaxSeconds ? 1 : 0 });
  }
  return uploads;
}

export async function submitReview(deps: IntakeDeps, submission: ReviewSubmission): Promise<{ id: string; visibility: Visibility }> {
  const policy = await checkPolicy(deps);
  const proof: PurchaseProof = submission.phone === undefined
    ? { orderNumber: submission.orderNumber, withoutPhone: true }
    : { orderNumber: submission.orderNumber, phone: submission.phone };
  const order = await proveOrder(deps, proof);
  const product = order.products.find((item) => item.productId === submission.productId);
  if (!product) throw new BusinessLogicError("This order cannot review this product", ERROR_CODES.PRODUCT_NOT_IN_ORDER, { productId: submission.productId });
  const alreadyReviewed = () => new ConflictError("This product was already reviewed from this order", ERROR_CODES.ORDER_ALREADY_REVIEWED, { productId: submission.productId });
  if (product.reviewed) throw alreadyReviewed();

  const uploads = submission.phone === undefined ? [] : await collectUploads(deps, policy, order.id, submission);
  if (uploads.length > 0 && !deps.workflow) {
    throw new BusinessLogicError("This store does not take photos or voice notes right now", ERROR_CODES.REVIEW_MEDIA_LIMIT, { max: 0 });
  }
  const statusWithMedia = statusOnArrival(policy, { hasMedia: true });
  const statusWithoutMedia = statusOnArrival(policy, { hasMedia: false });

  const inserted = await insertShopperReview(deps.db, {
    storeId: deps.storeId,
    productId: product.productId,
    order,
    rating: submission.rating,
    title: submission.title?.trim() || null,
    body: submission.body.trim(),
    status: uploads.length > 0 ? "processing" : statusWithoutMedia,
    verified: true,
  });
  if (!inserted.ok) throw alreadyReviewed();
  if (uploads.length === 0) return { id: inserted.id, visibility: statusWithoutMedia === "approved" ? "published" : "after_review" };

  const job: ReviewMediaJob = { reviewId: inserted.id, uploads, voiceMaxSeconds: policy.voiceMaxSeconds, statusWithMedia, statusWithoutMedia };
  try {
    await deps.workflow!.create({ id: reviewMediaInstanceId(inserted.id), params: job });
  } catch (error) {
    console.error(`[reviews] media job for review ${inserted.id} could not start; the review is kept without its files`, error);
    await settleWithoutMedia(deps.db, inserted.id, { status: statusWithoutMedia, dropped: uploads.length });
    return { id: inserted.id, visibility: statusWithoutMedia === "approved" ? "published" : "after_review" };
  }
  return { id: inserted.id, visibility: statusWithMedia === "approved" ? "published" : "after_review" };
}
