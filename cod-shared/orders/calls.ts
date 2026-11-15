/**
 * Calls without an answer, as a confirmation team counts them: the first
 * "No answer" makes an order Call 1, the next one Call 2, then Call 3. Teams
 * usually stop after the third and cancel by hand; nothing here stops them
 * or cancels for them. An order on no answer always has at least one call:
 * it gets there only by one (lifecycle.ts, `updateOrderStatus`).
 */
import { sql } from "drizzle-orm";
import { orders } from "../db/schema";

/** The lists a team works through: Call 1, Call 2, and Call 3 with every later call. */
export const CALL_LISTS = [1, 2, 3] as const;
export type CallList = (typeof CALL_LISTS)[number];

/** The orders on no answer in a list, in SQL. */
export function inCallList(list: CallList) {
  const calls = list === 3 ? sql`${orders.unansweredCalls} >= 3` : sql`${orders.unansweredCalls} = ${list}`;
  return sql`(${orders.status} = 'unreachable' and ${calls})`;
}
