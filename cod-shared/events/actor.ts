/**
 * Who caused a Business Event and the surface it came through
 * (Events context: Actor, Actor Kind, Origin).
 */

export const ACTOR_KINDS = ["staff", "agent", "shopper", "carrier", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Staff and agents are named by the staff member (an agent acts for one), a
 * carrier by its delivery company; a shopper and the system carry no name —
 * the order already says who the customer is.
 */
export type Actor =
  | { kind: "staff" | "agent" | "carrier"; id: string; name: string }
  | { kind: "shopper" | "system"; id: null; name: null };

export const ORIGINS = ["dashboard", "api", "agent", "storefront", "carrier_webhook", "carrier_sync", "schedule"] as const;
export type Origin = (typeof ORIGINS)[number];
