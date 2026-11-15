/**
 * An order's confirmation as it happened, for its history sheet: when it was
 * placed, each time it changed hands, each call without an answer by its
 * number, and the decision. Facts only, newest first: the merchant reads how
 * the call went and judges for themselves.
 */

import type { Translate } from "@/i18n/core";
import { callNumbers } from "@/features/orders/model";
import type { AssignmentStep, OrderDetail, OrderStatus } from "@/features/orders/types";

/** The statuses that tell the confirmation's story; preparing and shipping come after it. */
const CONFIRMATION_STATUSES = ["new", "unreachable", "confirmed", "cancelled"] as const satisfies readonly OrderStatus[];
type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export type HistoryEntry =
  | { kind: "handover"; id: string; at: string; step: AssignmentStep }
  | { kind: "status"; id: string; at: string; status: ConfirmationStatus; byName: string | null; call: number | null };

/** At one instant, the order is placed first, then given out, then worked. */
const RANK = { placed: 0, handover: 1, worked: 2 } as const;
const rank = (entry: HistoryEntry) => (entry.kind === "handover" ? RANK.handover : entry.status === "new" ? RANK.placed : RANK.worked);

const isConfirmationStatus = (status: OrderStatus): status is ConfirmationStatus => (CONFIRMATION_STATUSES as readonly OrderStatus[]).includes(status);

export function confirmationHistory(order: Pick<OrderDetail, "statusHistory" | "assignmentHistory" | "unansweredCalls">): HistoryEntry[] {
  const calls = callNumbers(order.statusHistory, order.unansweredCalls);
  const statuses: HistoryEntry[] = order.statusHistory.flatMap((step) =>
    isConfirmationStatus(step.status) ? [{ kind: "status" as const, id: step.id, at: step.timestamp, status: step.status, byName: step.byName, call: calls.get(step.id) ?? null }] : [],
  );
  const handovers: HistoryEntry[] = (order.assignmentHistory ?? []).map((step) => ({ kind: "handover", id: step.id, at: step.at, step }));
  return [...statuses, ...handovers].sort((left, right) => right.at.localeCompare(left.at) || rank(right) - rank(left) || right.id.localeCompare(left.id));
}

/** How an order came to who has it, in a few words. */
export function assignmentWay(t: Translate, step: AssignmentStep): string {
  if (step.to === null) return t("order.way_unassigned", { name: step.byName ?? "" });
  if (step.way === "take_back") return t("order.way_take_back", { name: step.from?.name ?? "" });
  if (step.way === "manual") return t("order.way_manual", { name: step.byName ?? "" });
  return t("order.way_automatic");
}

/**
 * When and how the order came to the member who has it, in one line:
 * "Assigned yesterday, automatically". Only when; if the latest handover is
 * not to them, or does not name who made it.
 */
export function assignedLine(t: Translate, time: string, step: AssignmentStep | undefined, assigneeId: string | null | undefined): string {
  if (!step?.to || step.to.id !== assigneeId) return t("order.since", { time });
  if (step.way === "take_back") return step.from ? t("order.since_take_back", { time, name: step.from.name }) : t("order.since", { time });
  if (step.way === "manual") return step.byName ? t("order.since_manual", { time, name: step.byName }) : t("order.since", { time });
  return t("order.since_automatic", { time });
}

export type GapAfter = { kind: "placed" } | { kind: "confirmed" } | { kind: "call"; call: number | null };
export interface Gap {
  minutes: number;
  after: GapAfter;
}

/**
 * How long after the step before it each call and decision came: the first
 * call from the order being placed, each later call from the one before, the
 * decision from the last call. A fact to judge a caller by, not a rule.
 */
export function historyGaps(entries: HistoryEntry[]): Map<string, Gap> {
  const gaps = new Map<string, Gap>();
  let previous: Extract<HistoryEntry, { kind: "status" }> | null = null;
  for (const entry of [...entries].reverse()) {
    if (entry.kind !== "status") continue;
    const after: GapAfter | null =
      previous === null
        ? null
        : previous.status === "new"
          ? { kind: "placed" }
          : previous.status === "confirmed"
            ? { kind: "confirmed" }
            : previous.status === "unreachable"
              ? { kind: "call", call: previous.call }
              : null;
    if (previous && after) gaps.set(entry.id, { minutes: Math.round((Date.parse(entry.at) - Date.parse(previous.at)) / 60_000), after });
    previous = entry;
  }
  return gaps;
}

/** A gap in a few words: minutes, hours and minutes, or days. */
export function gapWords(t: Translate, minutes: number): string {
  if (minutes < 1) return t("history.gap_now");
  if (minutes < 60) return t("history.gap_minutes", { minutes });
  if (minutes < 1440) return t("history.gap_hours", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") });
  return t("history.gap_days", { count: Math.floor(minutes / 1440) });
}

/** "2 h 05 min after call 1": the gap, and the step it is counted from. */
export function gapLine(t: Translate, gap: Gap): string {
  const words = gapWords(t, gap.minutes);
  if (gap.after.kind === "placed") return t("history.after_placed", { gap: words });
  if (gap.after.kind === "confirmed") return t("history.after_confirmed", { gap: words });
  return gap.after.call === null ? t("history.after_previous_call", { gap: words }) : t("history.after_call", { gap: words, call: gap.after.call });
}
