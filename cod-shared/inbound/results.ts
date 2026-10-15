/**
 * What an inbox event can turn out to be — shared by the server that
 * processes events and the dashboard that shows them. No database here.
 */

export const INBOX_RESULTS = ["pending", "ok", "ignored", "unmatched", "unknown_status", "deferred_settlement", "error", "dead"] as const;
export type InboxResult = (typeof INBOX_RESULTS)[number];

/** Results an event can be processed again from, by hand (`unmapped`: rows from before the inbox). */
export const RETRYABLE_RESULTS: readonly string[] = ["error", "dead", "unmatched", "unknown_status", "unmapped"];
