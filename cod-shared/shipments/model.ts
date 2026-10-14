/**
 * The shipment's own vocabulary, shared by every module that reasons about one.
 */

/** A carrier is an integrated delivery company; a driver is the store's own. A driver is not a carrier. */
export const SHIPMENT_KINDS = ["carrier", "driver"] as const;
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number];

/**
 * Where the handoff to a carrier stands.
 *   submitting — the shipment is reserved and the carrier is being called;
 *   accepted   — the carrier created the parcel (a driver shipment starts here);
 *   unknown    — the carrier did not make the outcome clear; it must be found
 *                by our reference or resolved by the merchant, never retried blindly.
 */
export const HANDOFF_STATES = ["submitting", "accepted", "unknown"] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

/**
 * Where a shipment event came from.
 *   webhook  — pushed by the carrier;
 *   pull     — read from the carrier's history (scheduled sync, merchant "sync");
 *   handoff  — written by CodFlow when the parcel was created or validated;
 *   merchant — reported by the merchant (a driver's progress, a return received);
 *   system   — decided by CodFlow itself (a handoff resolved, a stale reservation);
 *   legacy   — carried over from the old order status history.
 */
export const SHIPMENT_EVENT_SOURCES = ["webhook", "pull", "handoff", "merchant", "system", "legacy"] as const;
export type ShipmentEventSource = (typeof SHIPMENT_EVENT_SOURCES)[number];

/** How a driver payment line settles a shipment: the cash collected, or the driver's fee. */
export const SETTLEMENT_COMPONENTS = ["cod", "fee"] as const;
export type SettlementComponent = (typeof SETTLEMENT_COMPONENTS)[number];
