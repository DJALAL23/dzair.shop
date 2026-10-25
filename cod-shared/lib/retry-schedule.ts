/**
 * How long to wait after each failed try before the next one. Once the waits
 * are spent, the next failure is the last: a dead letter for the inbox, a Dead
 * Delivery for a Consumer.
 */

export interface RetrySchedule {
  /** Tries in all, the first included. */
  maxAttempts: number;
  /** When to try again after `attempts` tries have failed, or null when they are spent. */
  nextAttemptAfter(attempts: number, now: Date): string | null;
}

export function retrySchedule(waitMinutes: readonly number[]): RetrySchedule {
  const maxAttempts = waitMinutes.length + 1;
  return {
    maxAttempts,
    nextAttemptAfter(attempts, now) {
      if (attempts >= maxAttempts) return null;
      return new Date(now.getTime() + waitMinutes[Math.max(attempts, 1) - 1]! * 60_000).toISOString();
    },
  };
}
