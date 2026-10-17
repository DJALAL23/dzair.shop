/**
 * Coupons: the dashboard's reads and writes. What a coupon may be is decided
 * in `coupons/model.ts` (and enforced again by the database, migration 0052);
 * what it takes off a basket, in `coupons/engine.ts`.
 *
 * Every write is judged whole — the stored coupon with the edit applied — and
 * written in one batch with what it covers and who may use it, so a coupon is
 * never seen half-written.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  collections,
  couponCollections,
  couponCustomerGroups,
  couponCustomers,
  couponProducts,
  coupons,
  customerGroups,
  customers,
  orders,
  products,
} from "../db/schema";
import type { AppDb } from "../db/client";
import { couponProblem, couponState, normalizeCouponCode, type CouponAudience, type CouponKind, type CouponProblem, type CouponScope, type CouponShape, type CouponState } from "../coupons/model";
import { chunkIds, MAX_IN_ARRAY_IDS } from "./d1-limits";

export type CouponStatus = "active" | "inactive";

/** A coupon as the dashboard sends it. The code is taken as typed and stored in its one form. */
export interface CouponInput {
  code: string;
  kind: CouponKind;
  /** Percent or dinars; free delivery takes none. */
  value?: number;
  maxDiscount?: number | null;
  minSubtotal?: number | null;
  minQuantity?: number | null;
  scope: CouponScope;
  productIds?: string[];
  collectionIds?: string[];
  audience: CouponAudience;
  customerIds?: string[];
  groupIds?: string[];
  usageLimit?: number | null;
  oncePerCustomer?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  status: CouponStatus;
}

export type CouponPatch = Partial<CouponInput>;

/** The picks that name other records, and the reason a missing one gives. */
const PICKS = [
  { field: "productIds", table: products, reason: "unknown_product" },
  { field: "collectionIds", table: collections, reason: "unknown_collection" },
  { field: "customerIds", table: customers, reason: "unknown_customer" },
  { field: "groupIds", table: customerGroups, reason: "unknown_group" },
] as const;

export type CouponWriteProblem =
  | { reason: CouponProblem }
  | { reason: (typeof PICKS)[number]["reason"] }
  | { reason: "code_taken"; couponId: string };

type CouponRow = typeof coupons.$inferSelect;
type Written = CouponShape & { status: CouponStatus };

/** Uses (orders not cancelled) and the discount they were given, per coupon. */
async function usage(db: AppDb, id?: string): Promise<Map<string, { uses: number; discountGiven: number }>> {
  const rows = await db
    .select({ couponId: orders.couponId, uses: sql<number>`count(*)`, discountGiven: sql<number>`coalesce(sum(${orders.couponDiscount}), 0)` })
    .from(orders)
    .where(and(id ? eq(orders.couponId, id) : sql`${orders.couponId} is not null`, ne(orders.status, "cancelled")))
    .groupBy(orders.couponId)
    .all();
  return new Map(rows.map((row) => [row.couponId!, { uses: Number(row.uses), discountGiven: Number(row.discountGiven) }]));
}

function summary(row: CouponRow, used: { uses: number; discountGiven: number } | undefined, now: string) {
  const uses = used?.uses ?? 0;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    maxDiscount: row.maxDiscount,
    minSubtotal: row.minSubtotal,
    minQuantity: row.minQuantity,
    scope: row.scope,
    audience: row.audience,
    usageLimit: row.usageLimit,
    oncePerCustomer: row.oncePerCustomer,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    state: couponState(row, uses, now) satisfies CouponState,
    uses,
    discountGiven: used?.discountGiven ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CouponSummary = ReturnType<typeof summary> & {
  counts: { products: number; collections: number; customers: number; groups: number };
};

async function countsBy(db: AppDb, table: typeof couponProducts | typeof couponCollections | typeof couponCustomers | typeof couponCustomerGroups) {
  const rows = await db.select({ couponId: table.couponId, n: sql<number>`count(*)` }).from(table).groupBy(table.couponId).all();
  return new Map(rows.map((row) => [row.couponId, Number(row.n)]));
}

export async function listCoupons(db: AppDb, now = new Date().toISOString()): Promise<CouponSummary[]> {
  const [rows, used, productCounts, collectionCounts, customerCounts, groupCounts] = await Promise.all([
    db.select().from(coupons).orderBy(desc(coupons.createdAt)).all(),
    usage(db),
    countsBy(db, couponProducts),
    countsBy(db, couponCollections),
    countsBy(db, couponCustomers),
    countsBy(db, couponCustomerGroups),
  ]);
  return rows.map((row) => ({
    ...summary(row, used.get(row.id), now),
    counts: {
      products: productCounts.get(row.id) ?? 0,
      collections: collectionCounts.get(row.id) ?? 0,
      customers: customerCounts.get(row.id) ?? 0,
      groups: groupCounts.get(row.id) ?? 0,
    },
  }));
}

export async function getCouponById(db: AppDb, id: string, now = new Date().toISOString()) {
  const row = await db.select().from(coupons).where(eq(coupons.id, id)).get();
  if (!row) return null;
  const [used, pickedProducts, pickedCollections, pickedCustomers, pickedGroups] = await Promise.all([
    usage(db, id),
    db.select({ id: products.id, name: products.name, handle: products.handle }).from(couponProducts).innerJoin(products, eq(products.id, couponProducts.productId)).where(eq(couponProducts.couponId, id)).orderBy(products.name).all(),
    db.select({ id: collections.id, title: collections.title, handle: collections.handle }).from(couponCollections).innerJoin(collections, eq(collections.id, couponCollections.collectionId)).where(eq(couponCollections.couponId, id)).orderBy(collections.title).all(),
    db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(couponCustomers).innerJoin(customers, eq(customers.id, couponCustomers.customerId)).where(eq(couponCustomers.couponId, id)).orderBy(customers.name).all(),
    db.select({ id: customerGroups.id, name: customerGroups.name }).from(couponCustomerGroups).innerJoin(customerGroups, eq(customerGroups.id, couponCustomerGroups.groupId)).where(eq(couponCustomerGroups.couponId, id)).orderBy(customerGroups.name).all(),
  ]);
  return { ...summary(row, used.get(id), now), products: pickedProducts, collections: pickedCollections, customers: pickedCustomers, groups: pickedGroups };
}

export type CouponDetail = NonNullable<Awaited<ReturnType<typeof getCouponById>>>;

const unique = (ids: readonly string[] | undefined) => [...new Set(ids ?? [])];

/** The coupon a write would leave, in the shape the rules judge. A code that is not a code stays as typed, for the rules to refuse. */
function shapeOf(input: CouponInput): Written {
  return {
    code: normalizeCouponCode(input.code) ?? input.code,
    kind: input.kind,
    value: input.value ?? 0,
    maxDiscount: input.maxDiscount ?? null,
    minSubtotal: input.minSubtotal ?? null,
    minQuantity: input.minQuantity ?? null,
    scope: input.scope,
    productIds: unique(input.productIds),
    collectionIds: unique(input.collectionIds),
    audience: input.audience,
    customerIds: unique(input.customerIds),
    groupIds: unique(input.groupIds),
    usageLimit: input.usageLimit ?? null,
    oncePerCustomer: input.oncePerCustomer ?? false,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    status: input.status,
  };
}

/** Why this coupon cannot be written, or null: its own rules and the records it names. A taken code is the unique index's to refuse (`write`). */
async function writeProblem(db: AppDb, shape: Written): Promise<CouponWriteProblem | null> {
  const own = couponProblem(shape);
  if (own) return { reason: own };
  for (const pick of PICKS) {
    const ids = shape[pick.field];
    for (const chunk of chunkIds([...ids])) {
      const found = await db.select({ id: pick.table.id }).from(pick.table).where(inArray(pick.table.id, chunk)).all();
      if (found.length !== chunk.length) return { reason: pick.reason };
    }
  }
  return null;
}

function rowOf(shape: Written) {
  const { productIds: _p, collectionIds: _c, customerIds: _k, groupIds: _g, ...row } = shape;
  return row;
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Two bound values a row: this many rows stay within D1's per-statement limit. */
const ROWS_PER_INSERT = Math.floor(MAX_IN_ARRAY_IDS / 2);

/** Rows inserted in chunks that stay within D1's bound-parameter limit. */
function inserts<R>(rows: R[], insert: (chunk: R[]) => BatchStatement): BatchStatement[] {
  const statements: BatchStatement[] = [];
  for (let at = 0; at < rows.length; at += ROWS_PER_INSERT) statements.push(insert(rows.slice(at, at + ROWS_PER_INSERT)));
  return statements;
}

/** What the coupon covers and who may use it, written (and, on an update, first cleared). */
function pickStatements(db: AppDb, couponId: string, shape: Written, replace: boolean): BatchStatement[] {
  return [
    ...(replace
      ? [couponProducts, couponCollections, couponCustomers, couponCustomerGroups].map((table) => db.delete(table).where(eq(table.couponId, couponId)))
      : []),
    ...inserts(shape.productIds.map((productId) => ({ couponId, productId })), (rows) => db.insert(couponProducts).values(rows)),
    ...inserts(shape.collectionIds.map((collectionId) => ({ couponId, collectionId })), (rows) => db.insert(couponCollections).values(rows)),
    ...inserts(shape.customerIds.map((customerId) => ({ couponId, customerId })), (rows) => db.insert(couponCustomers).values(rows)),
    ...inserts(shape.groupIds.map((groupId) => ({ couponId, groupId })), (rows) => db.insert(couponCustomerGroups).values(rows)),
  ];
}

/** The code's unique index refused it: another coupon has the code. */
function codeTaken(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if (/UNIQUE constraint failed: coupons\.code/.test(cause.message)) return true;
  }
  return false;
}

async function write(db: AppDb, shape: Written, statements: BatchStatement[]): Promise<CouponWriteProblem | null> {
  try {
    await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
    return null;
  } catch (error) {
    if (!codeTaken(error)) throw error;
    const owner = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, shape.code)).get();
    if (!owner) throw error;
    return { reason: "code_taken", couponId: owner.id };
  }
}

export async function createCoupon(db: AppDb, input: CouponInput): Promise<{ ok: true; id: string } | ({ ok: false } & CouponWriteProblem)> {
  const shape = shapeOf(input);
  const problem = await writeProblem(db, shape);
  if (problem) return { ok: false, ...problem };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const conflict = await write(db, shape, [
    db.insert(coupons).values({ id, ...rowOf(shape), createdAt: now, updatedAt: now }),
    ...pickStatements(db, id, shape, false),
  ]);
  return conflict ? { ok: false, ...conflict } : { ok: true, id };
}

export async function updateCoupon(
  db: AppDb,
  id: string,
  patch: CouponPatch,
): Promise<{ ok: true } | { ok: false; reason: "not_found" } | ({ ok: false } & CouponWriteProblem)> {
  const stored = await getCouponById(db, id);
  if (!stored) return { ok: false, reason: "not_found" };
  const kind = patch.kind ?? stored.kind;
  const scope = patch.scope ?? stored.scope;
  const audience = patch.audience ?? stored.audience;
  // A change of kind starts its value and cap afresh, a change of scope or
  // audience its picks: a percentage turned into free delivery drops its
  // percent rather than being refused for it.
  const kindChanges = kind !== stored.kind;
  const keep = <T>(patched: T | undefined, current: T, fresh: T, changes: boolean) => (patched !== undefined ? patched : changes ? fresh : current);
  const shape = shapeOf({
    code: patch.code ?? stored.code,
    kind,
    value: keep(patch.value, stored.value, 0, kindChanges),
    maxDiscount: keep(patch.maxDiscount, stored.maxDiscount, null, kindChanges),
    minSubtotal: patch.minSubtotal !== undefined ? patch.minSubtotal : stored.minSubtotal,
    minQuantity: patch.minQuantity !== undefined ? patch.minQuantity : stored.minQuantity,
    scope,
    productIds: keep(patch.productIds, stored.products.map((p) => p.id), [], scope !== stored.scope),
    collectionIds: keep(patch.collectionIds, stored.collections.map((c) => c.id), [], scope !== stored.scope),
    audience,
    customerIds: keep(patch.customerIds, stored.customers.map((c) => c.id), [], audience !== stored.audience),
    groupIds: keep(patch.groupIds, stored.groups.map((g) => g.id), [], audience !== stored.audience),
    usageLimit: patch.usageLimit !== undefined ? patch.usageLimit : stored.usageLimit,
    oncePerCustomer: patch.oncePerCustomer ?? stored.oncePerCustomer,
    startsAt: patch.startsAt !== undefined ? patch.startsAt : stored.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : stored.endsAt,
    status: patch.status ?? stored.status,
  });
  const problem = await writeProblem(db, shape);
  if (problem) return { ok: false, ...problem };
  const conflict = await write(db, shape, [
    db.update(coupons).set({ ...rowOf(shape), updatedAt: new Date().toISOString() }).where(eq(coupons.id, id)),
    ...pickStatements(db, id, shape, true),
  ]);
  return conflict ? { ok: false, ...conflict } : { ok: true };
}

/** Deletes a coupon. Orders that used it keep its code and the discount they were given. */
export async function deleteCoupon(db: AppDb, id: string): Promise<boolean> {
  const result = await db.delete(coupons).where(eq(coupons.id, id)).run();
  return ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}
