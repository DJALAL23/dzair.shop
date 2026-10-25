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

/** Who made a change and through what: what every writer of a Business Event is given. */
export interface Author {
  actor: Actor;
  origin: Origin;
}

/** The staff member behind a change — themselves, or the one an agent acts for. Null for everyone else. */
export function staffOf(actor: Actor): { id: string; name: string } | null {
  return actor.kind === "staff" || actor.kind === "agent" ? { id: actor.id, name: actor.name } : null;
}

/** Who the store's ledgers (stock movements) credit with a change: its staff member, or the system. */
export function creditOf(actor: Actor): { id: string; name: string } {
  return staffOf(actor) ?? { id: "system", name: "النظام" };
}
