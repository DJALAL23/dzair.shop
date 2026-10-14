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
