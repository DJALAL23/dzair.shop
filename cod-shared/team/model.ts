/**
 * The confirmation team's vocabulary: how a store shares its orders out, what
 * a member is paid for, and how an order came to its member.
 */

/** How new orders reach the team: by hand, to each member in turn, or to whoever has the fewest orders waiting. */
export const DISTRIBUTIONS = ["manual", "in_turn", "evenly"] as const;
export type Distribution = (typeof DISTRIBUTIONS)[number];

/** A monthly salary, or an amount per order the member confirmed, or per such order delivered. */
export const PAY_KINDS = ["salary", "per_confirmed", "per_delivered"] as const;
export type PayKind = (typeof PAY_KINDS)[number];

/** How an order came to its member: the store's rule, a manager's choice, or taken back from a member who did not act. */
export const ASSIGNMENT_WAYS = ["automatic", "manual", "take_back"] as const;
export type AssignmentWay = (typeof ASSIGNMENT_WAYS)[number];

/** The statuses of an order still in a member's hands: not yet decided, or not reached yet. */
export const WAITING_STATUSES = ["new", "unreachable"] as const;

/** What a store with no team settings does: nothing shared out, no take-back. */
export const DEFAULT_TEAM_CONFIG = { distribution: "manual", takeBackMinutes: null, takeBackLimit: 2 } as const satisfies {
  distribution: Distribution;
  takeBackMinutes: number | null;
  takeBackLimit: number;
};
