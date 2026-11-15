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
