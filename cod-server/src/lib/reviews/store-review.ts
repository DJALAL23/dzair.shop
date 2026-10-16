/**
 * A review the store enters: one a customer gave by WhatsApp, phone or in
 * person. It names the product and a customer — from the list, or a name
 * typed in — and may rest on one of that customer's orders that brought the
 * product: a delivered one makes it a verified purchase, nothing else does.
 * It carries the date it is entered. Its photos and voice note go through
 * the same media job as a shopper's.
 */
import type { AppDb } from "@/db";
import { BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { insertStoreReview, settleWithoutMedia, storeReviewOrders, storeReviewSubjects } from "../../../../cod-shared/queries/reviews";
import { REVIEW_MAX_PHOTOS, REVIEW_VOICE_LENGTHS } from "../../../../cod-shared/reviews/model";
import { REVIEW_TEXT } from "../../../../cod-shared/reviews/policy";
import { isMediaId } from "../../../../cod-shared/reviews/media";
import { findReceived, receiveFile, type ReceivedFile } from "@/lib/review-media/receive";
import { reviewMediaInstanceId, type ReviewMediaJob } from "@/lib/review-media/job";

/** What the store may attach: the hard limits, whatever shoppers are allowed. */
export const STORE_ALLOWANCE = { maxPhotos: REVIEW_MAX_PHOTOS, voiceMaxSeconds: REVIEW_VOICE_LENGTHS[REVIEW_VOICE_LENGTHS.length - 1] };

/** One folder per staff member: files sent for a review not yet saved. */
export function staffFolder(userId: string): string {
  return `staff/${userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}`;
}

export interface StoreReviewDeps {
  db: AppDb;
  storeId: string;
  bucket: R2Bucket;
  workflow?: Pick<Workflow, "create">;
}

export async function receiveStaffUpload(
  deps: Pick<StoreReviewDeps, "bucket" | "workflow">,
  userId: string,
  input: { body: ReadableStream<Uint8Array> | null; declaredBytes?: number; declaredDurationMs?: number },
): Promise<ReceivedFile> {
  if (!deps.workflow) throw new BusinessLogicError("Photos and voice notes are not set up on this server", ERROR_CODES.REVIEW_MEDIA_LIMIT, { max: 0 });
  return receiveFile(deps.bucket, {
    folder: staffFolder(userId),
    ...input,
    allowance: STORE_ALLOWANCE,
    folderLimit: { image: 30, audio: 10 },
    metadata: { staff: userId },
  });
}

export interface StoreReviewInput {
  productId: string;
  customerId?: string | null;
  /** The name shown; defaults to the customer's. Required without a customer. */
  customerName?: string | null;
  orderId?: string | null;
  rating: number;
  title?: string | null;
  body: string;
  uploads?: string[];
  /** Publish at once, or keep it pending. */
  publish: boolean;
}

export async function createStoreReview(deps: StoreReviewDeps, actor: { id: string }, input: StoreReviewInput): Promise<{ id: string; status: "processing" | "pending" | "approved"; verified: boolean }> {
  const customerId = input.customerId || null;
  const { product, customer } = await storeReviewSubjects(deps.db, { productId: input.productId, customerId });
  if (!product) throw new NotFoundError("Product", input.productId);
  if (customerId && !customer) throw new NotFoundError("Customer", customerId);
  const customerName = (input.customerName?.trim() || customer?.name || "").slice(0, REVIEW_TEXT.nameMax);
  if (!customerName) throw new ValidationError("Name the customer, or choose one", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "customerName" });

  let order: { id: string; orderNumber: string; delivered: boolean } | null = null;
  if (input.orderId) {
    if (!customerId) throw new ValidationError("Choose the customer of the order", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "customerId" });
    const options = await storeReviewOrders(deps.db, { customerId, productId: input.productId });
    const found = options.find((option) => option.id === input.orderId);
    if (!found) throw new BusinessLogicError("This order of the customer did not bring this product", ERROR_CODES.PRODUCT_NOT_IN_ORDER, { orderId: input.orderId });
    if (found.reviewed) throw new ConflictError("This product was already reviewed from this order", ERROR_CODES.ORDER_ALREADY_REVIEWED, { orderId: input.orderId });
    order = { id: found.id, orderNumber: found.orderNumber, delivered: found.delivered };
  }

  const ids = [...new Set(input.uploads ?? [])];
  if (ids.some((id) => !isMediaId(id))) throw new BusinessLogicError("A file of this review was not received", ERROR_CODES.REVIEW_UPLOAD_NOT_FOUND);
  if (ids.length > 0 && !deps.workflow) throw new BusinessLogicError("Photos and voice notes are not set up on this server", ERROR_CODES.REVIEW_MEDIA_LIMIT, { max: 0 });
  const uploads = ids.length ? await findReceived(deps.bucket, staffFolder(actor.id), ids) : [];
  const photos = uploads.filter((upload) => upload.kind === "image").length;
  if (photos > STORE_ALLOWANCE.maxPhotos) throw new BusinessLogicError(`At most ${STORE_ALLOWANCE.maxPhotos} photos`, ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: "image", max: STORE_ALLOWANCE.maxPhotos });
  if (uploads.length - photos > 1) throw new BusinessLogicError("At most one voice note", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: "audio", max: 1 });

  const body = input.body.trim();
  if (body.length < REVIEW_TEXT.bodyMin && !uploads.some((upload) => upload.kind === "audio")) {
    throw new ValidationError(`Write at least ${REVIEW_TEXT.bodyMin} characters, or add a voice note`, ERROR_CODES.VALIDATION_FAILED, { field: "body", min: REVIEW_TEXT.bodyMin });
  }

  const landing = input.publish ? "approved" : "pending";
  const inserted = await insertStoreReview(deps.db, {
    storeId: deps.storeId,
    productId: product.id,
    customerId,
    customerName,
    order,
    rating: input.rating,
    title: input.title?.trim() || null,
    body,
    status: uploads.length ? "processing" : landing,
    createdBy: actor.id,
  });
  if (!inserted.ok) throw new ConflictError("This product was already reviewed from this order", ERROR_CODES.ORDER_ALREADY_REVIEWED, { orderId: input.orderId });
  const verified = order?.delivered ?? false;
  if (!uploads.length) return { id: inserted.id, status: landing, verified };

  const job: ReviewMediaJob = { reviewId: inserted.id, uploads, voiceMaxSeconds: STORE_ALLOWANCE.voiceMaxSeconds, statusWithMedia: landing, statusWithoutMedia: landing };
  try {
    await deps.workflow!.create({ id: reviewMediaInstanceId(inserted.id), params: job });
  } catch (error) {
    console.error(`[reviews] media job for store review ${inserted.id} could not start; kept without its files`, error);
    await settleWithoutMedia(deps.db, inserted.id, { status: landing, dropped: uploads.length });
    return { id: inserted.id, status: landing, verified };
  }
  return { id: inserted.id, status: "processing", verified };
}
