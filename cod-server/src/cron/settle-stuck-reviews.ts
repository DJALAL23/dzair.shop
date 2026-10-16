import type { Env } from "@/types/env";
import { getDb } from "@/db";
import { settleStuckReviews } from "../../../cod-shared/queries/reviews";

/** A media job finishes in minutes; an hour later, a review still waiting for one is settled without its files. */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

export async function runStuckReviewSweep(env: Env, now = Date.now()): Promise<void> {
  try {
    const settled = await settleStuckReviews(getDb(env.DB), new Date(now - STUCK_AFTER_MS).toISOString());
    if (settled > 0) console.error(`[reviews] ${settled} review(s) whose media job never finished went to the merchant's queue without their files`);
  } catch (error) {
    console.error("[reviews] stuck-review sweep failed", error);
  }
}
