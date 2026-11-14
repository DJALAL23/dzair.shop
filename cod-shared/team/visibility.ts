/**
 * Which orders a member may see and act on. A member who holds
 * `orders:read_assigned` and not `orders:read` works only the orders
 * assigned to them: every other order does not exist for them. Everyone else
 * is as before: what their other permissions allow, on every order.
 */

import { SCOPES } from "../rbac/scopes";

export type OrderVisibility = { kind: "all" } | { kind: "assigned"; userId: string };

export function orderVisibility(member: { id: string; role?: string; scopes?: readonly string[] }): OrderVisibility {
  const scopes = member.scopes ?? [];
  if (member.role === "admin" || scopes.includes(SCOPES.ALL) || scopes.includes(SCOPES.ORDERS_READ)) return { kind: "all" };
  return scopes.includes(SCOPES.ORDERS_READ_ASSIGNED) ? { kind: "assigned", userId: member.id } : { kind: "all" };
}

/** Whether an order with this assignee is visible. */
export function seesOrder(visibility: OrderVisibility, assigneeId: string | null): boolean {
  return visibility.kind === "all" || assigneeId === visibility.userId;
}
