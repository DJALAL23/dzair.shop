/**
 * The orders a confirmation team member may see (cod-shared/team/visibility):
 * for one who sees only their own, any other order answers as if it did not
 * exist, on every route that names an order or a shipment, and every list
 * holds only theirs.
 */

import type { Context, MiddlewareHandler } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { AppContext } from "@/types";
import { getDb, type AppDb } from "@/db";
import { orders, shipments } from "@/db/schema";
import { NotFoundError } from "@/lib/errors/classes";
import { orderVisibility, seesOrder, type OrderVisibility } from "../../../cod-shared/team/visibility";
import { chunkIds } from "../../../cod-shared/queries/d1-limits";

export function visibilityOf(c: Context<AppContext>): OrderVisibility {
  return orderVisibility(c.get("user"));
}

/** The member whose orders a list holds, or undefined for every order. */
export function ownOrdersOf(c: Context<AppContext>): string | undefined {
  const visibility = visibilityOf(c);
  return visibility.kind === "assigned" ? visibility.userId : undefined;
}

/**
 * Guards a router whose `:id` is an order: an order that is not the member's
 * is not found. An id that is no order (a sibling route such as
 * `/delivery-quote`) is left to its route.
 */
export function guardOrderId(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const visibility = visibilityOf(c);
    const id = c.req.param("id");
    if (visibility.kind === "assigned" && id) {
      const order = await getDb(c.env.DB).select({ assigneeId: orders.assigneeId }).from(orders).where(eq(orders.id, id)).get();
      if (order && !seesOrder(visibility, order.assigneeId)) throw new NotFoundError("Order", id);
    }
    await next();
  };
}

/** Guards a router whose `:id` is a shipment: one whose order is not the member's is not found. */
export function guardShipmentId(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const visibility = visibilityOf(c);
    const id = c.req.param("id");
    if (visibility.kind === "assigned" && id) {
      const row = await getDb(c.env.DB)
        .select({ assigneeId: orders.assigneeId })
        .from(shipments)
        .innerJoin(orders, eq(orders.id, shipments.orderId))
        .where(eq(shipments.id, id))
        .get();
      if (row && !seesOrder(visibility, row.assigneeId)) throw new NotFoundError("Shipment", id);
    }
    await next();
  };
}

/** Of these order ids, the ones the member may not see. */
export async function hiddenOrderIds(c: Context<AppContext>, orderIds: readonly string[]): Promise<Set<string>> {
  const visibility = visibilityOf(c);
  if (visibility.kind === "all" || orderIds.length === 0) return new Set();
  const db = getDb(c.env.DB);
  const hidden = new Set<string>();
  for (const chunk of chunkIds([...new Set(orderIds)])) {
    for (const row of await db.select({ id: orders.id, assigneeId: orders.assigneeId }).from(orders).where(inArray(orders.id, chunk)).all()) {
      if (!seesOrder(visibility, row.assigneeId)) hidden.add(row.id);
    }
  }
  return hidden;
}

/** Whether the order exists for this member: false when there is no such order, or it is not theirs. */
export async function orderVisibleTo(db: AppDb, visibility: OrderVisibility, orderId: string): Promise<boolean> {
  const order = await db.select({ assigneeId: orders.assigneeId }).from(orders).where(eq(orders.id, orderId)).get();
  return Boolean(order) && seesOrder(visibility, order!.assigneeId);
}

/** Whether the shipment's order exists for this member. */
export async function shipmentVisibleTo(db: AppDb, visibility: OrderVisibility, shipmentId: string): Promise<boolean> {
  const row = await db.select({ assigneeId: orders.assigneeId }).from(shipments).innerJoin(orders, eq(orders.id, shipments.orderId)).where(eq(shipments.id, shipmentId)).get();
  return Boolean(row) && seesOrder(visibility, row!.assigneeId);
}

type AnyTool = { execute?: (args: any, options: any) => unknown };

/**
 * The AI tools as a member who sees only their own orders may use them: a
 * tool given an order or a shipment that is not theirs answers that it was
 * not found, before it reads or changes anything.
 */
export function ownOrdersOnly<Tools extends Record<string, AnyTool>>(tools: Tools, db: AppDb, visibility: OrderVisibility): Tools {
  if (visibility.kind === "all") return tools;
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute) return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: async (args: unknown, options: unknown) => {
            const given = (args ?? {}) as { orderId?: unknown; shipmentId?: unknown };
            if (typeof given.orderId === "string" && !(await orderVisibleTo(db, visibility, given.orderId))) return { success: false, error: `Order not found with ID: ${given.orderId}` };
            if (typeof given.shipmentId === "string" && !(await shipmentVisibleTo(db, visibility, given.shipmentId))) return { success: false, error: `Shipment not found with ID: ${given.shipmentId}` };
            return execute(args, options);
          },
        },
      ];
    }),
  ) as Tools;
}
