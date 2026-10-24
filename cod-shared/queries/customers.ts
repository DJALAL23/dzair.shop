/**
 * Customers Queries
 *
 * deleteCustomer stays in cod-server because it raises BusinessLogicError.
 */

import { eq, and, like, or, desc, exists, sql } from "drizzle-orm";
import {
  customers,
  orders,
  orderStatusHistory,
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
  wilayaId: number;
  communeId?: string;
  address?: string;
}

export interface UpdateCustomerData {
  name?: string;
  phone?: string;
  phone2?: string | null;
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

  if (conditions.length > 0) {
    return await db
      .select()
      .from(customers)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .all();
  }
  return await db.select().from(customers).limit(limit).offset(offset).all();
}

export async function getCustomerById(db: AppDb, customerId: string) {
  const customer = await db
    .select()
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
 * storefront checkout links it — else a new customer, created here.
 */
export async function orderCustomerId(
  db: AppDb,
  data: { customerId: string; name: string; phone: string; wilayaId: number; communeId?: string | null; address?: string | null; now: string },
): Promise<string> {
  const known = await db
    .select({ id: customers.id })
    .from(customers)
    .where(or(eq(customers.id, data.customerId), eq(customers.phone, data.phone)))
    .all();
  const chosen = known.find((row) => row.id === data.customerId) ?? known[0];
  if (chosen) return chosen.id;

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
      wilayaId: data.wilayaId,
      communeId: data.communeId ?? null,
      wilaya: wilayaRow?.nameAr ?? String(data.wilayaId),
      commune: communeRow?.nameAr ?? null,
      address: data.address ?? null,
      totalOrders: 0,
      totalSpent: 0,
      createdAt: data.now,
      lastOrderAt: null,
    })
    .onConflictDoNothing({ target: customers.phone })
    .returning({ id: customers.id });
  if (created) return created.id;
  const raced = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, data.phone)).get();
  return raced!.id;
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
    wilayaId: customerData.wilayaId,
    communeId: customerData.communeId ?? null,
    wilaya: wilayaRow?.nameAr ?? String(customerData.wilayaId),
    commune: communeName,
    address: customerData.address || null,
    totalOrders: 0,
    totalSpent: 0,
    createdAt: now,
    lastOrderAt: null,
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

  const ordersWithHistory = await Promise.all(
    customerOrders.map(async (order) => {
      const history = await db
        .select()
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, order.id))
        .all();

      return {
        ...order,
        wilaya: order.wilayaName,
        commune: order.communeName,
        statusHistory: history,
      };
    }),
  );

  return ordersWithHistory;
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
