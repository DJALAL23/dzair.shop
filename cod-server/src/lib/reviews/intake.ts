/**
 * Taking in a shopper's review: everything between "find my order" and the
 * thank-you, behind three calls.
 *
 *   openReview      proves the purchase (order number + phone), says which
 *                   products can be reviewed and what may be attached, and
 *                   hands out an upload grant when the store takes media
 *   receiveUpload   prepares one photo or voice note and keeps it on the
 *                   store's host, under the grant (review-media/receive.ts)
 *   submitReview    proves the purchase again, and records the review with
 *                   the files it names, in one write — it lands at once
 *
 * The store's policy is read at each call, so a setting changed meanwhile
 * applies at once. Attempts are limited per order number (a phone cannot be
 * guessed for one order); the limit is by order, not by IP, because Algerian
 * mobile networks put many shoppers behind one address.
 */
import type { MediaDelivery } from "../../../../cod-shared/media/delivery";
import type { MediaImage } from "../../../../cod-shared/media/model";
import { imageOf } from "../../../../cod-shared/media/views";
import type { AppDb } from "@/db";
import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { findReviewableOrder, getReviewPolicy, insertShopperReview, type PurchaseProof, type ReviewableProduct } from "../../../../cod-shared/queries/store-reviews";
import { findUploads, type ReviewFile } from "../../../../cod-shared/queries/review-uploads";
import type { MediaLibrary } from "../../../../cod-shared/media/library";
import { REVIEW_TEXT, statusOnArrival, type ReviewPolicy } from "../../../../cod-shared/reviews/policy";
import type { ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import { isMediaId } from "../../../../cod-shared/reviews/media";
import { receiveFile, type ReceivedFile } from "@/lib/review-media/receive";
import { issueUploadGrant, readUploadGrant, type UploadGrant } from "@/lib/review-media/grant";

export interface IntakeDeps {
  db: AppDb;
  storeId: string;
  delivery: MediaDelivery;
  /** The store's Media Library; null when its media is not set up (text reviews only). */
  media: MediaLibrary | null;
  /** The Images binding: without it, no photos. */
  images?: ImagesBinding;
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
  /** `imageSrc` is the image's URL, for storefront SDKs that read it rather than `image` (@wocart/storefront ≤ 2.0). */
  products: Array<Omit<ReviewableProduct, "imageKey"> & { image: MediaImage | null; imageSrc: string | null }>;
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
  if (!deps.uploadSecret || !deps.media) return null;
  const maxPhotos = deps.images ? policy.maxPhotos : 0;
  if (maxPhotos === 0 && policy.voiceMaxSeconds === null) return null;
  return { maxPhotos, voiceMaxSeconds: policy.voiceMaxSeconds };
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
  const products = order.products.map(({ imageKey, ...product }) => {
    const image = imageOf(imageKey, deps.delivery);
    return { ...product, image, imageSrc: image?.url ?? null };
  });
  return { orderNumber: order.orderNumber, customerName: order.customerName, products, media };
}

async function grantFrom(deps: IntakeDeps, token: string | undefined): Promise<UploadGrant> {
  const grant = deps.uploadSecret && token ? await readUploadGrant(deps.uploadSecret, token) : null;
  if (!grant) throw new BusinessLogicError("The upload permission is missing or has expired — find your order again", ERROR_CODES.REVIEW_UPLOAD_GRANT_INVALID);
  return grant;
}

export async function receiveUpload(
  deps: IntakeDeps,
  input: { grant: string | undefined; body: ReadableStream<Uint8Array> | null; declaredBytes?: number; declaredDurationMs?: number },
): Promise<ReceivedFile> {
  const grant = await grantFrom(deps, input.grant);
  if (!deps.media) throw new BusinessLogicError("This store does not take photos or voice notes right now", ERROR_CODES.REVIEW_MEDIA_LIMIT, { max: 0 });
  return receiveFile({ db: deps.db, media: deps.media, images: deps.images }, {
    folder: grant.id,
    body: input.body,
    declaredBytes: input.declaredBytes,
    declaredDurationMs: input.declaredDurationMs,
    allowance: grant,
    folderLimit: { image: grant.maxPhotos + UPLOAD_SLACK, audio: 1 + UPLOAD_SLACK },
  });
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

const notReceived = (uploadId?: string) =>
  new BusinessLogicError("A file of this review was not received — send it again", ERROR_CODES.REVIEW_UPLOAD_NOT_FOUND, uploadId ? { uploadId } : {});

async function collectUploads(deps: IntakeDeps, policy: ReviewPolicy, orderId: string, submission: ReviewSubmission): Promise<ReviewFile[]> {
  const ids = [...new Set(submission.uploads ?? [])];
  if (ids.length === 0) return [];
  const grant = await grantFrom(deps, submission.grant);
  if (grant.orderId !== orderId) throw new BusinessLogicError("The upload permission is for another order", ERROR_CODES.REVIEW_UPLOAD_GRANT_INVALID);
  if (ids.some((id) => !isMediaId(id)) || !deps.media) throw notReceived();

  const found = await findUploads(deps.db, { folder: grant.id, ids, host: deps.media.hostKind });
  if ("missing" in found) throw notReceived(found.missing);
  const uploads = found.files;
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
  const body = submission.body.trim();
  if (body.length < REVIEW_TEXT.bodyMin && !uploads.some((upload) => upload.kind === "audio")) {
    throw new ValidationError(`Write at least ${REVIEW_TEXT.bodyMin} characters, or add a voice note`, ERROR_CODES.VALIDATION_FAILED, { field: "body", min: REVIEW_TEXT.bodyMin });
  }
  const status = statusOnArrival(policy, { hasMedia: uploads.length > 0 });

  const inserted = await insertShopperReview(deps.db, {
    storeId: deps.storeId,
    productId: product.productId,
    order,
    rating: submission.rating,
    title: submission.title?.trim() || null,
    body,
    status,
    verified: true,
    files: uploads,
  });
  if (!inserted.ok) throw inserted.reason === "upload_taken" ? notReceived() : alreadyReviewed();
  return { id: inserted.id, visibility: status === "approved" ? "published" : "after_review" };
}
