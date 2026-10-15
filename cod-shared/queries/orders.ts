/**
 * Orders Queries
 *
 * Centralized database operations for orders management.
 */

import { MAX_ORDER_NUMBER_DRAWS, drawOrderNumber, isOrderNumberCollision } from "../lib/order-number";
import type { AppDb } from "../db/client";
import {
  orders,
  orderProducts,
  orderStatusHistory,
  customers,
  productVariants,
  products,
  drivers,
  driverPaymentLines,
  users,
  wilayas,
  communes,
  stockMovements,
  companyShipments,
  companyApiLogs,
  webhookEvents,
  shipments,
} from "../db/schema";
import type { OrderStatus } from "../orders/lifecycle";
import {
  eq,
  desc,
  and,
  like,
  or,
  sql,
  getTableColumns,
  aliasedTable,
} from "drizzle-orm";

const driversAlias = aliasedTable(drivers, "d");

import { safeLikeTerm } from "./search";
import { orderNeedsAttentionSql, orderStageSql } from "../orders/stage-sql";
import type { OrderStage } from "../orders/stage";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];
import { insertSelectRow } from "../db/insert-select";
import { linesToRestock, restockStatements } from "../inventory/restock";
import { getCustomerByPhone, updateCustomer, type UpdateCustomerData } from "./customers";

export interface OrderFilters {
  status?: (typeof orders.$inferSelect)["status"] | "all";
  /** Where the order stands overall (stage.ts). */
  stage?: OrderStage;
  /** Only orders whose delivery needs the merchant (true), or only the others (false). */
  attention?: boolean;
  wilayaId?: number;
  search?: string;
  limit?: number;
  offset?: number;
  /**
   * Opaque keyset cursor (encodeOrderCursor output): return rows strictly
   * before (createdAt, id). Takes precedence over offset when set.
   */
  cursor?: string;
}

export function encodeOrderCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseOrderCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(b64);
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!id) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(createdAt)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Get all orders with optional filtering.
 * Joins wilayas + communes to return Arabic display names.
 */
export async function getAllOrders(db: AppDb, filters: OrderFilters = {}) {
  const conditions = [];

  if (filters.status && filters.status !== "all") {
    conditions.push(eq(orders.status, filters.status));
  }

  if (filters.stage) {
    conditions.push(sql`${orderStageSql()} = ${filters.stage}`);
  }

  if (filters.attention !== undefined) {
    conditions.push(filters.attention ? orderNeedsAttentionSql() : sql`not ${orderNeedsAttentionSql()}`);
  }

  if (filters.wilayaId) {
    conditions.push(eq(orders.wilayaId, filters.wilayaId));
  }

  if (filters.search) {
    const term = `%${safeLikeTerm(filters.search)}%`;
    conditions.push(
      or(
        like(orders.orderNumber, term),
        like(orders.customerName, term),
        like(orders.phone, term),
      ),
    );
  }

  let offset = filters.offset ?? 0;
  if (filters.cursor) {
    const after = parseOrderCursor(filters.cursor);
    if (after) {
      conditions.push(
        sql`(orders.created_at, orders.id) < (${after.createdAt}, ${after.id})`,
      );
      offset = 0;
    }
  }

  return db
    .select({
      ...getTableColumns(orders),
      wilaya: wilayas.nameAr,
      commune: communes.nameAr,
      driverName: sql<
        string | null
      >`CASE WHEN ${driversAlias.firstName} IS NOT NULL THEN ${driversAlias.firstName} || ' ' || ${driversAlias.lastName} ELSE NULL END`,
      hasReview: sql<number>`EXISTS (SELECT 1 FROM reviews WHERE reviews.order_id = orders.id)`,
      lastUpdatedBy: sql<
        string | null
      >`(SELECT by FROM order_status_history WHERE order_id = orders.id ORDER BY timestamp DESC LIMIT 1)`,
      shipmentId: sql<string | null>`${shipments.id}`,
      stage: orderStageSql(),
      needsAttention: orderNeedsAttentionSql(),
    })
    .from(orders)
    .leftJoin(wilayas, eq(orders.wilayaId, wilayas.id))
    .leftJoin(communes, eq(orders.communeId, communes.id))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .leftJoin(driversAlias, eq(shipments.driverId, driversAlias.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(filters.limit ?? 50)
    .offset(offset)
    .all();
}

export async function getOrderById(db: AppDb, orderId: string) {
  const order = await db
    .select({
      ...getTableColumns(orders),
      wilaya: wilayas.nameAr,
      commune: communes.nameAr,
      driverName: sql<
        string | null
      >`CASE WHEN ${driversAlias.firstName} IS NOT NULL THEN ${driversAlias.firstName} || ' ' || ${driversAlias.lastName} ELSE NULL END`,
    })
    .from(orders)
    .leftJoin(wilayas, eq(orders.wilayaId, wilayas.id))
    .leftJoin(communes, eq(orders.communeId, communes.id))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .leftJoin(driversAlias, eq(shipments.driverId, driversAlias.id))
    .where(eq(orders.id, orderId))
    .get();

  if (!order) return null;

  const [orderProductsList, historyRows] = await db.batch([
    db.select().from(orderProducts).where(eq(orderProducts.orderId, orderId)),
    db
      .select({
        id: orderStatusHistory.id,
        orderId: orderStatusHistory.orderId,
        status: orderStatusHistory.status,
        timestamp: orderStatusHistory.timestamp,
        by: orderStatusHistory.by,
        byName: users.name,
      })
      .from(orderStatusHistory)
      .leftJoin(users, eq(orderStatusHistory.by, users.id))
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.timestamp)),
  ]);

  return {
    ...order,
    products: orderProductsList,
    statusHistory: historyRows.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      status: h.status,
      timestamp: h.timestamp,
      by: h.by,
      byName: h.byName ?? null,
    })),
  };
}

export async function createOrder(
  db: AppDb,
  orderData: typeof orders.$inferInsert,
  productsData: Array<typeof orderProducts.$inferInsert>,
  actor?: { id: string; name: string } | null,
) {
  const now = orderData.createdAt ?? new Date().toISOString();

  const statements: BatchStatement[] = [
    db.insert(orders).values(orderData),
  ];

  if (productsData.length > 0) {
    statements.push(db.insert(orderProducts).values(productsData));
  }

  statements.push(
    db.insert(orderStatusHistory).values({
      id: crypto.randomUUID(),
      orderId: orderData.id!,
      status: orderData.status!,
      timestamp: orderData.createdAt!,
      by: null,
    }),
  );

  statements.push(
    db
      .update(customers)
      .set({
        totalOrders: sql`${customers.totalOrders} + 1`,
        totalSpent: sql`${customers.totalSpent} + ${orderData.price ?? 0}`,
        lastOrderAt: orderData.createdAt,
      })
      .where(eq(customers.id, orderData.customerId)),
  );

  for (const item of productsData) {
    const qty = item.quantity as number;

    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, item.productId))
      .get();

    if (!productRow?.trackInventory) continue;

    // Guarded deduction, same pattern as the storefront path: the movement's
    // qtyBefore/qtyAfter are subselects guarded by inventory >= qty. When
    // stock is insufficient (or a concurrent writer already took it), the
    // subselects return NULL, the movement insert violates NOT NULL, and the
    // ENTIRE batch rolls back — no oversell floor, no lost-update race.
    if (item.variantId) {
      statements.push(
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: item.productId,
          variantId: item.variantId,
          type: "ORDER_DEDUCTED",
          delta: -qty,
          qtyBefore: sql`(SELECT inventory FROM product_variants WHERE id = ${item.variantId} AND inventory >= ${qty})`,
          qtyAfter: sql`(SELECT inventory - ${qty} FROM product_variants WHERE id = ${item.variantId} AND inventory >= ${qty})`,
          reason: null,
          reference: orderData.id ?? null,
          createdBy: actor?.id ?? "system",
          createdByName: actor?.name ?? "النظام",
          createdAt: now,
        }),
      );
      statements.push(
        db
          .update(productVariants)
          .set({
            inventory: sql`${productVariants.inventory} - ${qty}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(productVariants.id, item.variantId),
              sql`${productVariants.inventory} >= ${qty}`,
            ),
          ),
      );
    } else {
      statements.push(
        db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          productId: item.productId,
          variantId: null,
          type: "ORDER_DEDUCTED",
          delta: -qty,
          qtyBefore: sql`(SELECT inventory FROM products WHERE id = ${item.productId} AND inventory >= ${qty})`,
          qtyAfter: sql`(SELECT inventory - ${qty} FROM products WHERE id = ${item.productId} AND inventory >= ${qty})`,
          reason: null,
          reference: orderData.id ?? null,
          createdBy: actor?.id ?? "system",
          createdByName: actor?.name ?? "النظام",
          createdAt: now,
        }),
      );
      statements.push(
        db
          .update(products)
          .set({
            inventory: sql`${products.inventory} - ${qty}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(products.id, item.productId),
              sql`${products.inventory} >= ${qty}`,
            ),
          ),
      );
    }
  }

  // Atomic: order row, lines, history, customer stats, stock deduction, and
  // ledger commit together or not at all. Guarded deductions make the batch
  // fail (and roll back entirely) when stock is insufficient — no silent
  // floor-at-zero, no lost-update races. A taken order number rolls it back
  // the same way, so the order row is drawn again and the batch retried.
  let orderNumber = orderData.orderNumber;
  for (let attempt = 1; ; attempt += 1) {
    statements[0] = db.insert(orders).values({ ...orderData, orderNumber });
    try {
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
      break;
    } catch (error) {
      if (attempt >= MAX_ORDER_NUMBER_DRAWS || !isOrderNumberCollision(error)) throw error;
      orderNumber = drawOrderNumber(now);
    }
  }

  return { id: orderData.id, orderNumber };
}

export type StatusChange = { ok: true } | { ok: false; reason: "not_found" | "has_shipment" | "changed" };

/**
 * Move an order to a new status, with its effects: history, and on cancel the
 * customer's spend rolled back and the goods restocked. (Delivery and return
 * are the shipment's milestones, with their own effects — record-events.ts.)
 *
 * Exactly once, in one batch: the history row is written only while the
 * order still has the status it was read with and has no shipment — the
 * statements of one batch run as one transaction, so that check holds for
 * the whole batch — and every other statement applies only if that history
 * row exists. Two cancels at once apply their effects once; a cancel racing
 * a handoff loses to it (an order with a shipment has no status change).
 */
export async function updateOrderStatus(
  db: AppDb,
  orderId: string,
  newStatus: OrderStatus,
  userId?: string,
  userName?: string,
): Promise<StatusChange> {
  const now = new Date().toISOString();

  const order = await db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return { ok: false, reason: "not_found" };

  const historyId = crypto.randomUUID();
  const unchanged = and(
    sql`exists (select 1 from ${orders} where ${orders.id} = ${orderId} and ${orders.status} = ${order.status})`,
    sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orderId})`,
  )!;
  const claimed = sql`exists (select 1 from ${orderStatusHistory} where ${orderStatusHistory.id} = ${historyId})`;

  const statements: BatchStatement[] = [
    db.insert(orderStatusHistory).select(
      db
        .select(
          insertSelectRow(orderStatusHistory, {
            id: sql`${historyId}`,
            orderId: sql`${orderId}`,
            status: sql`${newStatus}`,
            timestamp: sql`${now}`,
            by: sql`${userId ?? null}`,
          }) as never,
        )
        .from(sql`(select 1)`)
        .where(unchanged),
    ),
    db
      .update(orders)
      .set({ status: newStatus, updatedAt: now })
      .where(and(eq(orders.id, orderId), claimed)),
  ];

  if (newStatus === "cancelled" && order.status !== "cancelled") {
    statements.push(
      db
        .update(customers)
        .set({ totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price ?? 0})` })
        .where(and(eq(customers.id, order.customerId), claimed)),
    );
    const lines = await linesToRestock(db, orderId);
    statements.push(
      ...restockStatements(
        db,
        lines,
        "ORDER_CANCELLED",
        orderId,
        { id: userId ?? "system", name: userName ?? "النظام" },
        now,
        claimed,
      ),
    );
  }

  // Atomic: a mid-sequence failure leaves no partial state, so a retry is safe.
  const [history] = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  if (((history as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) return { ok: true };
  const shipment = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, orderId)).get();
  return { ok: false, reason: shipment ? "has_shipment" : "changed" };
}

export interface UpdateOrderData {
  customerName?: string;
  phone?: string;
  /** null clears the email; undefined leaves it untouched. */
  customerEmail?: string | null;
  wilayaId?: number;
  communeId?: string;
  city?: string | null;
  /** null clears the address; undefined leaves it untouched. */
  address?: string | null;
  deliveryType?: "home" | "stop_desk";
  notes?: string | null;
}

/**
 * Partial edit of an order's customer/destination fields. Identity (id,
 * orderNumber), pricing, and dispatch state are deliberately not patchable —
 * pricing is fixed at creation. Once the order has a shipment its delivery
 * details are refused here (`has_shipment`): the parcel carries them, so they
 * change through the shipment, which edits the carrier first and then calls
 * this with `throughShipment`.
 *
 * The linked customer record is kept in sync in the same operation: name,
 * phone, wilaya/commune, and address edits flow into `customers`, so an order
 * and its customer never disagree on who they belong to (phone is the
 * customer identity). Only fields this edit actually changes are written.
 * When the corrected phone already belongs to a different customer record,
 * the order is re-pointed to that record instead of hijacking its phone.
 * customerEmail is order-only — customers have no email column.
 */
/** The delivery details a shipment carries: once an order has one, they change only through it. */
export const DELIVERY_DETAIL_FIELDS = ["customerName", "phone", "wilayaId", "communeId", "city", "address", "deliveryType"] as const satisfies ReadonlyArray<keyof UpdateOrderData>;

export type OrderEdit = { ok: true } | { ok: false; reason: "not_found" | "has_shipment" };

export async function updateOrder(
  db: AppDb,
  orderId: string,
  updates: UpdateOrderData,
  options: { throughShipment?: boolean } = {},
): Promise<OrderEdit> {
  const current = await db
    .select({
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      wilayaId: orders.wilayaId,
      communeId: orders.communeId,
      address: orders.address,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .get();

  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.customerName !== undefined) patch.customerName = updates.customerName;
  if (updates.phone !== undefined) patch.phone = updates.phone;
  if (updates.customerEmail !== undefined) patch.customerEmail = updates.customerEmail;
  if (updates.wilayaId !== undefined) patch.wilayaId = updates.wilayaId;
  if (updates.communeId !== undefined) patch.communeId = updates.communeId;
  if (updates.city !== undefined) patch.city = updates.city;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.deliveryType !== undefined) patch.deliveryType = updates.deliveryType;
  if (updates.notes !== undefined) patch.notes = updates.notes;

  const customerUpdates: UpdateCustomerData = {};
  if (current) {
    if (updates.customerName !== undefined && updates.customerName !== current.customerName) {
      customerUpdates.name = updates.customerName;
    }
    if (updates.wilayaId !== undefined && updates.wilayaId !== current.wilayaId) {
      customerUpdates.wilayaId = updates.wilayaId;
    }
    if (updates.communeId !== undefined && updates.communeId !== current.communeId) {
      customerUpdates.communeId = updates.communeId;
    }
    if (updates.address !== undefined && (updates.address ?? null) !== (current.address ?? null)) {
      customerUpdates.address = updates.address ?? null;
    }

    if (updates.phone !== undefined && updates.phone !== current.phone) {
      const phoneOwner = await getCustomerByPhone(db, updates.phone);
      if (phoneOwner && phoneOwner.id !== current.customerId) {
        // The corrected number already identifies another customer record —
        // move the order to it. Only fields this edit changed flow onto it,
        // never the previous customer's identity.
        patch.customerId = phoneOwner.id;
      } else {
        customerUpdates.phone = updates.phone;
      }
    }
  }

  if (!current) return { ok: false, reason: "not_found" };

  // Atomic with the handoff: a reservation and this edit can never both win.
  const touchesDelivery = DELIVERY_DETAIL_FIELDS.some((field) => updates[field] !== undefined);
  const locked = touchesDelivery && !options.throughShipment;
  const [result] = await db.batch([
    db
      .update(orders)
      .set(patch)
      .where(
        locked
          ? and(eq(orders.id, orderId), sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orderId})`)
          : eq(orders.id, orderId),
      ),
  ]);
  if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) return { ok: false, reason: "has_shipment" };

  const customerTarget = (patch.customerId as string | undefined) ?? current?.customerId;
  if (customerTarget && Object.keys(customerUpdates).length > 0) {
    await updateCustomer(db, customerTarget, customerUpdates);
  }
  return { ok: true };
}

export async function setOrderProductReturn(
  db: AppDb,
  orderId: string,
  productLineId: string,
  newReturnedQty: number,
  userId?: string,
  userName?: string,
): Promise<{
  id: string;
  status: "fulfilled" | "partially_returned" | "returned";
  returnedQuantity: number;
  quantity: number;
}> {
  const now = new Date().toISOString();

  const line = await db
    .select()
    .from(orderProducts)
    .where(and(eq(orderProducts.id, productLineId), eq(orderProducts.orderId, orderId)))
    .get();

  if (!line) {
    throw new Error(`Order line ${productLineId} not found on order ${orderId}`);
  }

  if (newReturnedQty < 0 || newReturnedQty > line.quantity) {
    throw new Error(
      `returnedQuantity must be between 0 and ${line.quantity} (got ${newReturnedQty})`,
    );
  }

  const currentReturned = line.returnedQuantity ?? 0;
  const delta = newReturnedQty - currentReturned;

  if (delta !== 0) {
    const productRow = await db
      .select({ trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, line.productId))
      .get();

    if (productRow?.trackInventory) {
      if (line.variantId) {
        const variantRow = await db
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, line.variantId))
          .get();

        const qtyBefore = variantRow?.inventory ?? 0;
        const qtyAfter = Math.max(0, qtyBefore + delta);

        await db
          .update(productVariants)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(productVariants.id, line.variantId));

        await db
          .insert(stockMovements)
          .values({
            id: crypto.randomUUID(),
            productId: line.productId,
            variantId: line.variantId,
            type: "ORDER_RETURNED",
            delta,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          })
          .catch((err) =>
            console.error("[stock] Failed to log ORDER_RETURNED movement:", err),
          );
      } else {
        const productInventoryRow = await db
          .select({ inventory: products.inventory })
          .from(products)
          .where(eq(products.id, line.productId))
          .get();

        const qtyBefore = productInventoryRow?.inventory ?? 0;
        const qtyAfter = Math.max(0, qtyBefore + delta);

        await db
          .update(products)
          .set({ inventory: qtyAfter, updatedAt: now })
          .where(eq(products.id, line.productId));

        await db
          .insert(stockMovements)
          .values({
            id: crypto.randomUUID(),
            productId: line.productId,
            variantId: null,
            type: "ORDER_RETURNED",
            delta,
            qtyBefore,
            qtyAfter,
            reason: null,
            reference: orderId,
            createdBy: userId ?? "system",
            createdByName: userName ?? "النظام",
            createdAt: now,
          })
          .catch((err) =>
            console.error("[stock] Failed to log ORDER_RETURNED movement:", err),
          );
      }
    }
  }

  const newStatus: "fulfilled" | "partially_returned" | "returned" =
    newReturnedQty === 0
      ? "fulfilled"
      : newReturnedQty === line.quantity
        ? "returned"
        : "partially_returned";

  await db
    .update(orderProducts)
    .set({ status: newStatus, returnedQuantity: newReturnedQty })
    .where(eq(orderProducts.id, productLineId));

  return {
    id: line.id,
    status: newStatus,
    returnedQuantity: newReturnedQty,
    quantity: line.quantity,
  };
}

export type OrderDeletion = { ok: true } | { ok: false; reason: "not_found" | "has_open_shipment" | "settled" | "changed" };

const DELETE_ATTEMPTS = 3;

/**
 * Delete an order and undo what it did: the customer's order count and spend,
 * the driver's credit for a delivery not settled, and the goods still out of
 * stock.
 *
 * Refused while the order has an open shipment — a parcel at a carrier would
 * be orphaned; void it first — and once a driver payment settled part of its
 * shipment: the payment keeps it. A closed shipment goes with the order: a
 * delivered one keeps its goods with the customer (no restock), a returned
 * one already restocked and rolled the spend back.
 *
 * One batch, applied only while the order and its shipment are as they were
 * read (the statements of a batch run as one transaction); if either changed
 * meanwhile, the deletion is planned again.
 */
export async function deleteOrder(db: AppDb, orderId: string): Promise<OrderDeletion> {
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt++) {
    const outcome = await attemptDelete(db, orderId);
    if (outcome.ok || outcome.reason !== "changed") return outcome;
  }
  return { ok: false, reason: "changed" };
}

async function attemptDelete(db: AppDb, orderId: string): Promise<OrderDeletion> {
  const now = new Date().toISOString();
  const order = await db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return { ok: false, reason: "not_found" };
  const shipment = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).get();
  const shipmentClosed = !!shipment && (shipment.deliveredAt !== null || shipment.returnedAt !== null || shipment.cancelledAt !== null);
  if (shipment && !shipmentClosed) return { ok: false, reason: "has_open_shipment" };
  if (shipment && (await db.select({ id: driverPaymentLines.id }).from(driverPaymentLines).where(eq(driverPaymentLines.shipmentId, shipment.id)).get())) {
    return { ok: false, reason: "settled" };
  }

  const asRead = and(
    sql`exists (select 1 from ${orders} where ${orders.id} = ${orderId} and ${orders.status} = ${order.status} and ${orders.updatedAt} = ${order.updatedAt})`,
    shipment
      ? sql`exists (select 1 from ${shipments} where ${shipments.orderId} = ${orderId} and ${shipments.revision} = ${shipment.revision})`
      : sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orderId})`,
    shipment ? sql`not exists (select 1 from ${driverPaymentLines} where ${driverPaymentLines.shipmentId} = ${shipment.id})` : undefined,
  )!;

  const statements: BatchStatement[] = [];

  // totalOrders always drops; totalSpent only while the order still counted
  // as spend — a cancelled or returned order already rolled it back.
  const spendAlreadyRolledBack = order.status === "cancelled" || shipment?.returnedAt != null;
  statements.push(
    db
      .update(customers)
      .set({
        totalOrders: sql`MAX(0, ${customers.totalOrders} - 1)`,
        ...(spendAlreadyRolledBack ? {} : { totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price ?? 0})` }),
      })
      .where(and(eq(customers.id, order.customerId), asRead)),
  );

  // A delivery by the store's driver not settled: the driver no longer holds that cash, nor earned that fee.
  if (shipment?.kind === "driver" && shipment.driverId && shipment.deliveredAt) {
    statements.push(
      db
        .update(drivers)
        .set({
          totalDelivered: sql`MAX(0, ${drivers.totalDelivered} - 1)`,
          totalEarnings: sql`MAX(0, ${drivers.totalEarnings} - ${shipment.driverFee})`,
          pendingCash: sql`MAX(0, ${drivers.pendingCash} - ${shipment.codAmount})`,
          updatedAt: now,
        })
        .where(and(eq(drivers.id, shipment.driverId), asRead)),
    );
  }

  if (!shipment?.deliveredAt) {
    const lines = await linesToRestock(db, orderId);
    statements.push(...restockStatements(db, lines, "ORDER_CANCELLED", orderId, { id: "system", name: "النظام" }, now, asRead, "Order deleted - inventory restored"));
  }

  // company_api_logs and webhook_events reference orders(id) with no action on
  // delete; shipments, their events, reviews and history cascade.
  statements.push(
    db.delete(companyApiLogs).where(and(eq(companyApiLogs.orderId, orderId), asRead)),
    db.delete(webhookEvents).where(and(eq(webhookEvents.orderId, orderId), asRead)),
    db.delete(companyShipments).where(and(eq(companyShipments.orderId, orderId), asRead)),
    db.delete(orderProducts).where(and(eq(orderProducts.orderId, orderId), asRead)),
    db.delete(orders).where(and(eq(orders.id, orderId), asRead)),
  );

  const results = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  const deleted = ((results.at(-1) as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
  return deleted ? { ok: true } : { ok: false, reason: "changed" };
}
