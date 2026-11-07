/**
 * Customers Queries
 *
 * deleteCustomer stays in cod-server because it raises BusinessLogicError.
 */

import { eq, and, like, or, desc, exists, isNull, sql, getTableColumns } from "drizzle-orm";
import {
  customers,
  orders,
  customerGroups,
  customerGroupMembers,
  customerTags,
  customerTagAssignments,
  wilayas,
  communes,
  shipments,
} from "../db/schema";
import type { AppDb } from "../db/client";
import { safeLikeTerm } from "./search";
import { orderStageSql } from "../orders/stage-sql";

/**
 * A customer's totals, read from their orders — never stored, so they cannot
 * drift from them (Customers context: Orders, Spent, Last Order):
 *   totalOrders — every order they placed;
 *   totalSpent  — the goods of their delivered orders, net of the units they
 *                 refused at the door (a line's total is already net of its
 *                 coupon share);
 *   lastOrderAt — when they placed their newest order.
 */
export const customerTotals = {
  totalOrders: sql<number>`(select count(*) from orders o where o.customer_id = "customers"."id")`.mapWith(Number),
  totalSpent: sql<number>`(select coalesce(sum(op.line_total * (op.quantity - op.returned_quantity) / op.quantity), 0)
    from order_products op
    join orders o on o.id = op.order_id
    join shipments s on s.order_id = o.id
    where o.customer_id = "customers"."id" and s.delivered_at is not null and op.quantity > 0)`.mapWith(Number),
  lastOrderAt: sql<string | null>`(select max(o.created_at) from orders o where o.customer_id = "customers"."id")`,
};

/** A customer as every read answers it: the row and its totals. */
export const customerColumns = { ...getTableColumns(customers), ...customerTotals };

export interface CustomerFilters {
  wilayaId?: number;
  groupId?: string;
  tagId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateCustomerData {
  name: string;
  phone: string;
  phone2?: string;
  email?: string;
  wilayaId: number;
  communeId?: string;
  address?: string;
}

export interface UpdateCustomerData {
  name?: string;
  phone?: string;
  phone2?: string | null;
  email?: string | null;
  wilayaId?: number;
  communeId?: string | null;
  address?: string | null;
}

export async function getAllCustomers(db: AppDb, filters?: CustomerFilters) {
  const conditions = [];

  if (filters?.wilayaId) {
    conditions.push(eq(customers.wilayaId, filters.wilayaId));
  }

  if (filters?.search) {
    const term = `%${safeLikeTerm(filters.search)}%`;
    conditions.push(
      or(
        like(customers.name, term),
        like(customers.phone, term),
        like(customers.email, term),
      ),
    );
  }

  if (filters?.groupId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(customerGroupMembers)
          .where(
            and(
              eq(customerGroupMembers.customerId, customers.id),
              eq(customerGroupMembers.groupId, filters.groupId),
            ),
          ),
      ),
    );
  }

  if (filters?.tagId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(customerTagAssignments)
          .where(
            and(
              eq(customerTagAssignments.customerId, customers.id),
              eq(customerTagAssignments.tagId, filters.tagId),
            ),
          ),
      ),
    );
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  return await db
    .select(customerColumns)
    .from(customers)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getCustomerById(db: AppDb, customerId: string) {
  const customer = await db
    .select(customerColumns)
    .from(customers)
    .where(eq(customers.id, customerId))
    .get();

  if (!customer) {
    return null;
  }

  const recentOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .limit(10)
    .all();

  return {
    ...customer,
    recentOrders,
  };
}

export async function getCustomerByPhone(db: AppDb, phone: string) {
  return await db
    .select()
    .from(customers)
    .where(eq(customers.phone, phone))
    .get();
}

/**
 * The customer an order the merchant enters belongs to: the one chosen, else
 * the one who already has this phone — a phone is one customer, as the
 * storefront checkout links it — else a new customer, created here. The
 * order's email becomes the customer's only when they have none yet.
 */
export async function orderCustomerId(
  db: AppDb,
  data: { customerId: string; name: string; phone: string; email?: string | null; wilayaId: number; communeId?: string | null; address?: string | null; now: string },
): Promise<string> {
  const known = await db
    .select({ id: customers.id })
    .from(customers)
    .where(or(eq(customers.id, data.customerId), eq(customers.phone, data.phone)))
    .all();
  const chosen = known.find((row) => row.id === data.customerId) ?? known[0];
  if (chosen) {
    if (data.email) await fillCustomerEmail(db, chosen.id, data.email);
    return chosen.id;
  }

  const [wilayaRow, communeRow] = await Promise.all([
    db.select({ nameAr: wilayas.nameAr }).from(wilayas).where(eq(wilayas.id, data.wilayaId)).get(),
    data.communeId
      ? db.select({ nameAr: communes.nameAr }).from(communes).where(eq(communes.id, data.communeId)).get()
      : Promise.resolve(null),
  ]);
  const [created] = await db
    .insert(customers)
    .values({
      id: data.customerId,
      name: data.name,
      phone: data.phone,
      phone2: null,
      email: data.email ?? null,
      wilayaId: data.wilayaId,
      communeId: data.communeId ?? null,
      wilaya: wilayaRow?.nameAr ?? String(data.wilayaId),
      commune: communeRow?.nameAr ?? null,
      address: data.address ?? null,
      createdAt: data.now,
    })
    .onConflictDoNothing({ target: customers.phone })
    .returning({ id: customers.id });
  if (created) return created.id;
  const raced = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, data.phone)).get();
  if (data.email) await fillCustomerEmail(db, raced!.id, data.email);
  return raced!.id;
}

/** An order's email given to its customer, only if they have none: a later order never overwrites it. */
export async function fillCustomerEmail(db: AppDb, customerId: string, email: string) {
  await db.update(customers).set({ email }).where(and(eq(customers.id, customerId), isNull(customers.email)));
}

export async function createCustomer(db: AppDb, customerData: CreateCustomerData) {
  const now = new Date().toISOString();
  const customerId = crypto.randomUUID();

  const wilayaRow = await db
    .select({ nameAr: wilayas.nameAr })
    .from(wilayas)
    .where(eq(wilayas.id, customerData.wilayaId))
    .get();

  let communeName: string | null = null;
  if (customerData.communeId) {
    const communeRow = await db
      .select({ nameAr: communes.nameAr })
      .from(communes)
      .where(eq(communes.id, customerData.communeId))
      .get();
    communeName = communeRow?.nameAr ?? null;
  }

  const newCustomer = {
    id: customerId,
    name: customerData.name,
    phone: customerData.phone,
    phone2: customerData.phone2 || null,
    email: customerData.email ?? null,
    wilayaId: customerData.wilayaId,
    communeId: customerData.communeId ?? null,
    wilaya: wilayaRow?.nameAr ?? String(customerData.wilayaId),
    commune: communeName,
    address: customerData.address || null,
    createdAt: now,
  };

  await db.insert(customers).values(newCustomer);

  return getCustomerById(db, customerId);
}

export async function updateCustomer(
  db: AppDb,
  customerId: string,
  updates: UpdateCustomerData,
) {
  const updateData: Record<string, unknown> = { ...updates };

  if (updates.wilayaId !== undefined) {
    const wilayaRow = await db
      .select({ nameAr: wilayas.nameAr })
      .from(wilayas)
      .where(eq(wilayas.id, updates.wilayaId))
      .get();
    updateData.wilaya = wilayaRow?.nameAr ?? String(updates.wilayaId);
  }

  if (updates.communeId !== undefined) {
    if (updates.communeId === null) {
      updateData.commune = null;
    } else {
      const communeRow = await db
        .select({ nameAr: communes.nameAr })
        .from(communes)
        .where(eq(communes.id, updates.communeId))
        .get();
      updateData.commune = communeRow?.nameAr ?? null;
    }
  }

  await db.update(customers).set(updateData).where(eq(customers.id, customerId));
  return getCustomerById(db, customerId);
}

export async function getOrdersByCustomerId(db: AppDb, customerId: string) {
  const customerOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      price: orders.price,
      createdAt: orders.createdAt,
      wilayaId: orders.wilayaId,
      communeId: orders.communeId,
      wilayaName: wilayas.nameAr,
      communeName: communes.nameAr,
      stage: orderStageSql(),
    })
    .from(orders)
    .leftJoin(wilayas, eq(orders.wilayaId, wilayas.id))
    .leftJoin(communes, eq(orders.communeId, communes.id))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .all();

  return customerOrders.map((order) => ({ ...order, wilaya: order.wilayaName, commune: order.communeName }));
}

export async function getCustomerGroupMemberships(db: AppDb, customerId: string) {
  return await db
    .select({
      id: customerGroups.id,
      name: customerGroups.name,
      color: customerGroups.color,
      description: customerGroups.description,
      memberCount: customerGroups.memberCount,
      createdAt: customerGroups.createdAt,
      updatedAt: customerGroups.updatedAt,
      assignedAt: customerGroupMembers.assignedAt,
    })
    .from(customerGroupMembers)
    .innerJoin(customerGroups, eq(customerGroups.id, customerGroupMembers.groupId))
    .where(eq(customerGroupMembers.customerId, customerId))
    .all();
}

export async function getCustomerTagMemberships(db: AppDb, customerId: string) {
  return await db
    .select({
      id: customerTags.id,
      name: customerTags.name,
      color: customerTags.color,
      assignmentCount: customerTags.assignmentCount,
      createdAt: customerTags.createdAt,
      updatedAt: customerTags.updatedAt,
      assignedAt: customerTagAssignments.assignedAt,
    })
    .from(customerTagAssignments)
    .innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId))
    .where(eq(customerTagAssignments.customerId, customerId))
    .all();
}
