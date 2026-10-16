import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { assertTurnstile } from "../turnstile-gate";
import { reviewMediaUrl } from "@/lib/review-media/urls";
import { openReview, receiveUpload, submitReview, type IntakeDeps } from "@/lib/reviews/intake";
import { getReviewPolicy, listApprovedReviews } from "../../../../../cod-shared/queries/store-reviews";
import type { ReviewSubmissionInput } from "./validation";

type Valid<T> = { valid: (target: "json" | "query") => T };

function deps(c: Context<AppContext>): IntakeDeps {
  return {
    db: getDb(c.env.DB),
    storeId: c.get("storeId")!,
    bucket: c.env.IMAGES,
    workflow: c.env.REVIEW_MEDIA_WORKFLOW,
    uploadSecret: (c.env.REVIEW_UPLOAD_SECRET?.length ?? 0) >= 32 ? c.env.REVIEW_UPLOAD_SECRET : undefined,
    limiter: c.env.REVIEW_RATE_LIMITER,
  };
}

export async function listReviews(c: Context<AppContext>) {
  const { productId, limit, offset } = (c.req as unknown as Valid<{ productId: string; limit: number; offset: number }>).valid("query");
  const db = getDb(c.env.DB);
  const storeId = c.get("storeId")!;
  if (!(await getReviewPolicy(db, storeId)).enabled) return c.json({ success: true, data: [], count: 0, total: 0 }, 200);
  const mediaUrl = reviewMediaUrl(c.env, c.req.url);
  const { rows, total } = await listApprovedReviews(db, { storeId, productId, limit, offset, mediaUrl });
  return c.json({ success: true, data: rows, count: rows.length, total }, 200);
}

export async function checkEligibility(c: Context<AppContext>) {
  const input = (c.req as unknown as Valid<{ orderNumber: string; phone: string; turnstileToken?: string }>).valid("json");
  const intake = deps(c);
  await assertTurnstile(c, intake.db, { turnstileToken: input.turnstileToken });
  return c.json({ success: true, data: await openReview(intake, input) }, 200);
}

export async function uploadMedia(c: Context<AppContext>) {
  const length = Number(c.req.header("content-length"));
  const duration = Number(c.req.header("x-media-duration-ms"));
  const received = await receiveUpload(deps(c), {
    grant: c.req.header("x-review-grant"),
    body: c.req.raw.body,
    declaredBytes: Number.isFinite(length) && length > 0 ? length : undefined,
    declaredDurationMs: Number.isInteger(duration) && duration > 0 && duration <= 600_000 ? duration : undefined,
  });
  return c.json({ success: true, data: received }, 201);
}

export async function submit(c: Context<AppContext>) {
  const input = (c.req as unknown as Valid<ReviewSubmissionInput>).valid("json");
  return c.json({ success: true, data: await submitReview(deps(c), input) }, 201);
}
