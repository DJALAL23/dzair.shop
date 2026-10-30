/**
 * CodReviewMediaWorkflow — prepares a shopper's review photos and voice note
 * after the review was answered, then lands the review (published or
 * waiting, as the store chose). Started by the storefront submission with
 * instance ID `review-<reviewId>`; params carry R2 keys, never bytes.
 *
 * Each file is its own step, retried on passing failures. A file that still
 * fails is dropped and counted — the review is never lost for one file.
 * The work itself is lib/review-media/prepare.ts.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { z } from "zod";
import type { Env } from "@/types/env";
import { getDb } from "@/db";
import { mediaOf } from "@/lib/media";
import { attachMedia, clearUploads, prepareUpload, type PreparedUpload } from "@/lib/review-media/prepare";
import type { ReviewMediaJob } from "@/lib/review-media/job";
import { REVIEW_MEDIA_KINDS } from "../../../cod-shared/reviews/model";
import { REVIEW_UPLOAD_PREFIX } from "../../../cod-shared/reviews/media";
import { staging } from "@/lib/staging";

const landing = z.enum(["pending", "approved"]);

export const ReviewMediaJobSchema: z.ZodType<ReviewMediaJob> = z.strictObject({
  reviewId: z.string().min(1),
  uploads: z
    .array(
      z.strictObject({
        key: z.string().startsWith(REVIEW_UPLOAD_PREFIX).regex(/\/[a-f0-9]{32}$/),
        kind: z.enum(REVIEW_MEDIA_KINDS),
        contentType: z.string().min(1),
        bytes: z.number().int().positive(),
        declaredDurationMs: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(8),
  voiceMaxSeconds: z.number().int().positive().nullable(),
  statusWithMedia: landing,
  statusWithoutMedia: landing,
});

const RETRIED = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;

export class CodReviewMediaWorkflow extends WorkflowEntrypoint<Env, ReviewMediaJob> {
  async run(event: WorkflowEvent<ReviewMediaJob>, step: WorkflowStep) {
    const parsed = ReviewMediaJobSchema.safeParse(event.payload);
    if (!parsed.success) throw new NonRetryableError(`Invalid review media job: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    const job = parsed.data;
    const media = mediaOf(this.env);
    const deps = { staging: staging(this.env.MEDIA_BUCKET), media, images: this.env.IMAGE_TRANSFORM };

    const outcomes: PreparedUpload[] = [];
    for (const [index, upload] of job.uploads.entries()) {
      try {
        outcomes.push(await step.do(`prepare-${index}`, RETRIED, () => prepareUpload(deps, job, upload)));
      } catch (error) {
        console.error(`[reviews] review ${job.reviewId}: file ${index} could not be prepared, dropped`, error);
        outcomes.push({ kept: false, reason: "failed" });
      }
    }

    const landed = await step.do("attach-media", RETRIED, () => attachMedia(getDb(this.env.DB), media, job, outcomes));
    await step.do("clear-uploads", RETRIED, () => clearUploads(deps.staging, job));

    return {
      reviewId: job.reviewId,
      landed,
      kept: outcomes.filter((outcome) => outcome.kept).length,
      dropped: outcomes.flatMap((outcome) => (outcome.kept ? [] : [outcome.reason])),
    };
  }
}
