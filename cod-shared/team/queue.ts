/**
 * The confirmation team's queues, as conditions on an order: what waits for
 * someone to act. One definition, read by the team's overview (how many) and
 * by the orders list (which ones).
 */

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { orders } from "../db/schema";
import { DEFAULT_TEAM_CONFIG, WAITING_STATUSES } from "./model";

export const TEAM_QUEUES = ["unassigned", "needs_manager", "former"] as const;
export type TeamQueue = (typeof TEAM_QUEUES)[number];

/** True when the order's holder can no longer work it: they left the team, or their account is inactive. */
export const heldByFormerMember = sql`(${orders.assigneeId} is not null and not exists (select 1 from team_agents a join users u on u.id = a.user_id where a.user_id = ${orders.assigneeId} and u.status = 'active'))`;

const takeBackLimit = sql`coalesce((select take_back_limit from store_team_config limit 1), ${DEFAULT_TEAM_CONFIG.takeBackLimit})`;
const takeBackOn = sql`(select take_back_minutes from store_team_config limit 1) is not null`;

/** Each queue, among orders still waiting (new, or the customer not reached) and not archived. */
export const TEAM_QUEUE_SQL: Record<TeamQueue, SQL> = {
  unassigned: and(eq(orders.status, "new"), isNull(orders.assigneeId))!,
  needs_manager: sql`(${orders.status} = 'new' and ${orders.assigneeId} is not null and ${orders.takeBacks} >= ${takeBackLimit} and ${takeBackOn})`,
  former: heldByFormerMember,
};

/** The orders a queue holds. */
export function inTeamQueue(queue: TeamQueue): SQL {
  return and(inArray(orders.status, WAITING_STATUSES), isNull(orders.archivedAt), TEAM_QUEUE_SQL[queue])!;
}
