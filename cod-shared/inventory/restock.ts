/**
 * Putting an order's goods back into stock — the one implementation, used when
 * an order is cancelled before shipping and when its shipment comes back.
 *
 * Every statement guards itself on what it read: a line is restocked only if
 * its returned quantity is still the one this plan was made from, so a line
 * return recorded meanwhile, or the same restock planned twice, can never put
 * the same unit back twice. Callers add their own guard on top (a shipment's
 * revision) so the whole restock applies together with the fact that caused it.
 *
 * The movement's before/after quantities are read at execution, inside the
 * batch, so the ledger matches the inventory it describes.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orderProducts, productVariants, products, stockMovements } from "../db/schema";

export type RestockReason = "ORDER_CANCELLED" | "ORDER_RETURNED";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

export interface RestockActor {
  id: string;
  name: string;
}

export interface RestockLine {
  lineId: string;
  productId: string;
  variantId: string | null;
  /** Units not yet back in stock when the plan was made. */
  remaining: number;
  /** The line's returned quantity the plan was made from. */
  returnedBefore: number;
  quantity: number;
}

/** The order's lines that still have units out of stock, for products that track inventory. */
export async function linesToRestock(db: AppDb, orderId: string): Promise<RestockLine[]> {
  const rows = await db
    .select({
      lineId: orderProducts.id,
      productId: orderProducts.productId,
      variantId: orderProducts.variantId,
      quantity: orderProducts.quantity,
      returnedQuantity: orderProducts.returnedQuantity,
      trackInventory: products.trackInventory,
    })
    .from(orderProducts)
    .innerJoin(products, eq(products.id, orderProducts.productId))
    .where(eq(orderProducts.orderId, orderId))
    .all();
  return rows
    .filter((r) => r.trackInventory && r.quantity - (r.returnedQuantity ?? 0) > 0)
    .map((r) => ({
      lineId: r.lineId,
      productId: r.productId,
      variantId: r.variantId,
      remaining: r.quantity - (r.returnedQuantity ?? 0),
      returnedBefore: r.returnedQuantity ?? 0,
      quantity: r.quantity,
    }));
}

/**
 * The statements that put each line's remaining units back and mark the line
 * fully returned. `guard`, when given, must hold for any of it to apply;
 * `note` is kept on each stock movement.
 */
export function restockStatements(
  db: AppDb,
  lines: readonly RestockLine[],
  reason: RestockReason,
  reference: string,
  actor: RestockActor,
  now: string,
  guard?: SQL,
  note: string | null = null,
): BatchStatement[] {
  const statements: BatchStatement[] = [];
  for (const line of lines) {
    const unchanged = sql`exists (select 1 from ${orderProducts} where ${orderProducts.id} = ${line.lineId} and ${orderProducts.returnedQuantity} = ${line.returnedBefore})`;
    const applies = guard ? and(unchanged, guard)! : unchanged;
    const stock = line.variantId
      ? sql`(select ${productVariants.inventory} from ${productVariants} where ${productVariants.id} = ${line.variantId})`
      : sql`(select ${products.inventory} from ${products} where ${products.id} = ${line.productId})`;

    statements.push(
      db.insert(stockMovements).select(
        db
          .select({
            id: sql`${crypto.randomUUID()}`.as("id"),
            productId: sql`${line.productId}`.as("product_id"),
            variantId: sql`${line.variantId}`.as("variant_id"),
            type: sql`${reason}`.as("type"),
            delta: sql`${line.remaining}`.as("delta"),
            qtyBefore: sql`${stock}`.as("qty_before"),
            qtyAfter: sql`${stock} + ${line.remaining}`.as("qty_after"),
            reason: sql`${note}`.as("reason"),
            reference: sql`${reference}`.as("reference"),
            createdBy: sql`${actor.id}`.as("created_by"),
            createdByName: sql`${actor.name}`.as("created_by_name"),
            createdAt: sql`${now}`.as("created_at"),
          })
          .from(sql`(select 1)`)
          .where(applies),
      ),
    );
    statements.push(
      line.variantId
        ? db
            .update(productVariants)
            .set({ inventory: sql`${productVariants.inventory} + ${line.remaining}`, updatedAt: now })
            .where(and(eq(productVariants.id, line.variantId), applies))
        : db
            .update(products)
            .set({ inventory: sql`${products.inventory} + ${line.remaining}`, updatedAt: now })
            .where(and(eq(products.id, line.productId), applies)),
    );
    statements.push(
      db
        .update(orderProducts)
        .set({ status: "returned", returnedQuantity: line.quantity })
        .where(and(eq(orderProducts.id, line.lineId), applies)),
    );
  }
  return statements;
}
