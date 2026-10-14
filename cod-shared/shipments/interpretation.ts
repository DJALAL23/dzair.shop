/**
 * Shipment delivery facts — what CodFlow concludes from what carriers report.
 *
 * A carrier's raw status is authoritative and kept verbatim; this module never
 * replaces it. Each status is *interpreted* by its carrier's adapter (or, for
 * the store's own drivers, by `driver.ts`), and the interpretation moves a
 * shipment's set-once milestones. There is deliberately no shipment status
 * column (ADR 0006): milestones are facts with the time they happened, and a
 * closed shipment never reopens.
 *
 * Pure: `recordShipmentEvents` persists exactly what `applyEvent` decides, so
 * every rule here is tested without a database.
 */

import { ERROR_CODES } from "../errors/codes";

export const MILESTONES = [
  "out_for_delivery",
  "delivered",
  "return_started",
  "returned",
  "cancelled",
] as const;

export type Milestone = (typeof MILESTONES)[number];

export type Interpretation =
  /** A delivery fact. `attention` when the merchant must also act (a return waiting to be collected). */
  | { kind: "milestone"; milestone: Milestone; attention?: boolean }
  /** An attempt failed; the carrier may try again. */
  | { kind: "failed_attempt" }
  /** The carrier needs the merchant to act: an alert, a blocked or suspended parcel, an abandoned one. */
  | { kind: "exception" }
  /** The carrier collected or paid out the cash. Implies delivered; settlement is not this domain. */
  | { kind: "collection" }
  /** The parcel moved without changing what CodFlow knows. */
  | { kind: "progress" }
  /** A status this adapter does not recognize. Kept raw; nothing is guessed. */
  | { kind: "unknown" };

export type InterpretationKind = Interpretation["kind"];

export const INTERPRETATION_KINDS: readonly InterpretationKind[] = [
  "milestone",
  "failed_attempt",
  "exception",
  "collection",
  "progress",
  "unknown",
];

/** A shipment's delivery state, as stored. */
export interface DeliveryFacts {
  providerStatus: string | null;
  providerStatusKind: InterpretationKind | null;
  providerStatusAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  returnStartedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  deliveryAttempts: number;
  attentionSince: string | null;
}

/**
 * One reported status, already interpreted. `occurredAt` is in the canonical
 * UTC form `Date.prototype.toISOString()` produces, so comparing two of them as
 * strings compares them in time; adapters convert carrier-local times first.
 */
export interface ObservedStatus {
  providerStatus: string;
  interpretation: Interpretation;
  occurredAt: string;
}

/** A report that contradicts what the shipment already established. Recorded, never applied. */
export type Anomaly =
  /** Delivered vs returned vs cancelled: the shipment already closed differently. */
  | "conflicting_outcome"
  /** A milestone dated after the shipment closed. */
  | "after_closure"
  | "cancelled_after_out_for_delivery"
  /** Cash collected on a parcel that came back — worth a merchant's look. */
  | "collection_after_return";

export interface AppliedEvent {
  next: DeliveryFacts;
  /** Milestones this event set for the first time — the only ones consumers act on. */
  reached: Milestone[];
  /** Whether this event is now the shipment's current provider status. */
  becameCurrent: boolean;
  anomaly: Anomaly | null;
}

export const EMPTY_DELIVERY_FACTS: DeliveryFacts = {
  providerStatus: null,
  providerStatusKind: null,
  providerStatusAt: null,
  outForDeliveryAt: null,
  deliveredAt: null,
  returnStartedAt: null,
  returnedAt: null,
  cancelledAt: null,
  deliveryAttempts: 0,
  attentionSince: null,
};

export function closingMilestone(facts: DeliveryFacts): "delivered" | "returned" | "cancelled" | null {
  if (facts.deliveredAt) return "delivered";
  if (facts.returnedAt) return "returned";
  if (facts.cancelledAt) return "cancelled";
  return null;
}

export function isClosed(facts: DeliveryFacts): boolean {
  return closingMilestone(facts) !== null;
}

function needsAttention(interpretation: Interpretation): boolean {
  return (
    interpretation.kind === "exception" ||
    (interpretation.kind === "milestone" && interpretation.attention === true)
  );
}

const MILESTONE_FIELD = {
  out_for_delivery: "outForDeliveryAt",
  delivered: "deliveredAt",
  return_started: "returnStartedAt",
  returned: "returnedAt",
  cancelled: "cancelledAt",
} as const satisfies Record<Milestone, keyof DeliveryFacts>;

const CLOSING: ReadonlySet<Milestone> = new Set(["delivered", "returned", "cancelled"]);

/** The milestone an interpretation asserts, if any. A collection signal asserts delivery. */
function assertedMilestone(interpretation: Interpretation): Milestone | null {
  if (interpretation.kind === "milestone") return interpretation.milestone;
  if (interpretation.kind === "collection") return "delivered";
  return null;
}

/** Why a milestone cannot be recorded on these facts, or null when it can. */
function conflictFor(facts: DeliveryFacts, milestone: Milestone, occurredAt: string, interpretation: Interpretation): Anomaly | null {
  const closedBy = closingMilestone(facts);
  if (CLOSING.has(milestone)) {
    if (closedBy === null) {
      return milestone === "cancelled" && facts.outForDeliveryAt !== null
        ? "cancelled_after_out_for_delivery"
        : null;
    }
    if (closedBy === milestone) return null;
    return interpretation.kind === "collection" && closedBy === "returned"
      ? "collection_after_return"
      : "conflicting_outcome";
  }
  if (closedBy === null) return null;
  if (closedBy === "cancelled") {
    return milestone === "out_for_delivery" ? "cancelled_after_out_for_delivery" : "after_closure";
  }
  return occurredAt <= facts[MILESTONE_FIELD[closedBy]]! ? null : "after_closure";
}

/**
 * Apply one reported status to a shipment.
 *
 * The caller has already dropped duplicates (same event key), so every call is
 * a new report. Carriers deliver events out of order, so for any consistent
 * timeline the result does not depend on the order reports arrive in:
 *   - The newest report by `occurredAt` is the current provider status; an
 *     older one arriving late is history. Ties go to the later arrival.
 *   - A milestone is never cleared and holds the earliest time it was
 *     reported (a payout arriving before the delivery report must not become
 *     the delivery time). Consumers act only on the report that first set it.
 *   - Delivered, returned and cancelled close the shipment and exclude one
 *     another. Something that happened before the closure is still recorded;
 *     a different outcome, or a milestone after the closure, is an anomaly and
 *     sets nothing.
 *   - A return that started can still end delivered (the customer collects at
 *     the desk late), so `return_started` does not close.
 *   - A shipment cancelled by its carrier never went out for delivery; a
 *     report saying otherwise is an anomaly.
 *   - Attention follows the current status: open while it is an exception (or
 *     a milestone needing the merchant), closed by any other current status or
 *     by the shipment closing.
 */
export function applyEvent(facts: DeliveryFacts, event: ObservedStatus): AppliedEvent {
  const next: DeliveryFacts = { ...facts };
  const reached: Milestone[] = [];
  let anomaly: Anomaly | null = null;

  const becameCurrent = facts.providerStatusAt === null || event.occurredAt >= facts.providerStatusAt;
  if (becameCurrent) {
    next.providerStatus = event.providerStatus;
    next.providerStatusKind = event.interpretation.kind;
    next.providerStatusAt = event.occurredAt;
  }

  const milestone = assertedMilestone(event.interpretation);
  if (milestone !== null) {
    anomaly = conflictFor(facts, milestone, event.occurredAt, event.interpretation);
    if (anomaly === null) {
      const field = MILESTONE_FIELD[milestone];
      const current = next[field];
      if (current === null) {
        next[field] = event.occurredAt;
        reached.push(milestone);
      } else if (event.occurredAt < current) {
        next[field] = event.occurredAt;
      }
    }
  } else if (event.interpretation.kind === "failed_attempt") {
    const closedBy = closingMilestone(facts);
    const closedAt = closedBy === null ? null : facts[MILESTONE_FIELD[closedBy]];
    if (closedAt === null || event.occurredAt <= closedAt) {
      next.deliveryAttempts = facts.deliveryAttempts + 1;
    }
  }

  if (isClosed(next)) {
    next.attentionSince = null;
  } else if (becameCurrent) {
    if (!needsAttention(event.interpretation)) next.attentionSince = null;
    else if (next.attentionSince === null) next.attentionSince = event.occurredAt;
  }

  return { next, reached, becameCurrent, anomaly };
}

export type ShipmentRuleVerdict =
  | { ok: true }
  | {
      ok: false;
      code:
        | typeof ERROR_CODES.SHIPMENT_CLOSED
        | typeof ERROR_CODES.SHIPMENT_NOT_VOIDABLE
        | typeof ERROR_CODES.SHIPMENT_REPORT_NOT_ALLOWED
        | typeof ERROR_CODES.SHIPMENT_HANDOFF_PENDING;
    };

/**
 * Whether a shipment can be voided — undone so the order can be handed off
 * again. Only a shipment that never reached the customer qualifies: one the
 * carrier cancelled, or one that has not gone out for delivery (for a carrier,
 * the carrier must also accept the deletion).
 */
export function checkVoid(facts: DeliveryFacts): ShipmentRuleVerdict {
  if (facts.deliveredAt !== null || facts.returnedAt !== null) {
    return { ok: false, code: ERROR_CODES.SHIPMENT_CLOSED };
  }
  if (facts.cancelledAt !== null) return { ok: true };
  if (facts.outForDeliveryAt !== null || facts.returnStartedAt !== null) {
    return { ok: false, code: ERROR_CODES.SHIPMENT_NOT_VOIDABLE };
  }
  return { ok: true };
}
