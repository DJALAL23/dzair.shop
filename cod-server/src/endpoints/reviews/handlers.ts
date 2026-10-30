import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { logActivity, ACTIONS } from "@/lib/activity";
import { NotFoundError } from "@/lib/errors/classes";
import { mediaDeliveryOf } from "@/lib/media";
import { mediaUrl } from "../../../../cod-shared/media/delivery";
import { removeReview, removeReviewMedia } from "@/lib/reviews/removal";
import { createStoreReview, receiveStaffUpload } from "@/lib/reviews/store-review";
import { getAllReviews, getReviewById, storeReviewOrders, updateReviewStatus, type MerchantReview } from "../../../../cod-shared/queries/reviews";
import { getStore } from "../../../../cod-shared/queries/stores";
import type { createReviewSchema, listQuerySchema, orderOptionsQuerySchema, updateBodySchema } from "./validation";
import { staging } from "@/lib/staging";

type Valid = { valid: <T>(target: "json" | "query") => T };
const valid = <T>(c: Context<AppContext>, target: "json" | "query") => (c.req as unknown as Valid).valid<T>(target);

/** A review with its files' URLs instead of their keys. */
function present(c: Context<AppContext>) {
  const delivery = mediaDeliveryOf(c.env);
  return (review: MerchantReview) => ({
    ...review,
    media: review.media.map(({ mediaKey, thumbKey, ...media }) => ({ ...media, url: mediaUrl(mediaKey, delivery), thumbUrl: thumbKey ? mediaUrl(thumbKey, delivery) : null })),
  });
}

export async function listReviews(c: Context<AppContext>) {
  const filters = valid<z.infer<typeof listQuerySchema>>(c, "query");
  const { rows, total, pendingCount } = await getAllReviews(getDb(c.env.DB), filters);
  return c.json({ success: true, data: rows.map(present(c)), count: rows.length, total, pendingCount }, 200);
}

export async function getReview(c: Context<AppContext>) {
  const review = await getReviewById(getDb(c.env.DB), c.req.param("id")!);
  if (!review) throw new NotFoundError("Review", c.req.param("id"));
  return c.json({ success: true, data: present(c)(review) }, 200);
}

export async function updateReview(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const { status } = valid<z.infer<typeof updateBodySchema>>(c, "json");
  const existing = await getReviewById(db, id);
  if (!existing) throw new NotFoundError("Review", id);
  const updated = await updateReviewStatus(db, id, status);
  if (!updated) throw new NotFoundError("Review", id);
  if (status !== existing.status && status !== "pending") {
    await logActivity(db, c.get("user"), status === "approved" ? ACTIONS.REVIEW_APPROVED : ACTIONS.REVIEW_REJECTED, { type: "review", id, label: existing.customerName }, { rating: existing.rating, orderNumber: existing.orderNumber });
  }
  return c.json({ success: true, data: present(c)(updated) }, 200);
}

export async function deleteReview(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const removed = await removeReview(db, c.env, id);
  if (!removed) throw new NotFoundError("Review", id);
  await logActivity(db, c.get("user"), ACTIONS.REVIEW_DELETED, { type: "review", id, label: removed.customerName }, { rating: removed.rating, orderNumber: removed.orderNumber, media: removed.media.length });
  return c.json({ success: true }, 200);
}

export async function deleteMedia(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const mediaId = c.req.param("mediaId")!;
  const review = await getReviewById(db, id);
  if (!review) throw new NotFoundError("Review", id);
  const kind = await removeReviewMedia(db, c.env, id, mediaId);
  if (!kind) throw new NotFoundError("Review media", mediaId);
  await logActivity(db, c.get("user"), ACTIONS.REVIEW_MEDIA_REMOVED, { type: "review", id, label: review.customerName }, { kind });
  return c.json({ success: true, data: present(c)((await getReviewById(db, id))!) }, 200);
}

export async function createReview(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const input = valid<z.infer<typeof createReviewSchema>>(c, "json");
  const actor = c.get("user")!;
  const created = await createStoreReview({ db, storeId: await storeIdOf(c), staging: staging(c.env.MEDIA_BUCKET), workflow: c.env.REVIEW_MEDIA_WORKFLOW }, actor, input);
  const subject = created.status === "processing" ? null : await getReviewById(db, created.id);
  await logActivity(db, actor, ACTIONS.REVIEW_CREATED, { type: "review", id: created.id, label: subject?.customerName ?? input.customerName ?? undefined }, { rating: input.rating, verified: created.verified, media: input.uploads?.length ?? 0 });
  return c.json({ success: true, data: { ...created, review: subject ? present(c)(subject) : null } }, 201);
}

export async function uploadMedia(c: Context<AppContext>) {
  const length = Number(c.req.header("content-length"));
  const duration = Number(c.req.header("x-media-duration-ms"));
  const received = await receiveStaffUpload(
    { staging: staging(c.env.MEDIA_BUCKET), workflow: c.env.REVIEW_MEDIA_WORKFLOW },
    c.get("user")!.id,
    {
      body: c.req.raw.body,
      declaredBytes: Number.isFinite(length) && length > 0 ? length : undefined,
      declaredDurationMs: Number.isInteger(duration) && duration > 0 && duration <= 600_000 ? duration : undefined,
    },
  );
  return c.json({ success: true, data: received }, 201);
}

export async function orderOptions(c: Context<AppContext>) {
  const query = valid<z.infer<typeof orderOptionsQuerySchema>>(c, "query");
  return c.json({ success: true, data: await storeReviewOrders(getDb(c.env.DB), query) }, 200);
}

/** This deployment's store (single-tenant): the one stores row. */
async function storeIdOf(c: Context<AppContext>): Promise<string> {
  const store = await getStore(getDb(c.env.DB));
  if (!store) throw new NotFoundError("Store");
  return store.id;
}
