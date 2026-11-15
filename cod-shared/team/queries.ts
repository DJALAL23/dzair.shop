/**
 * The confirmation team as the dashboard reads and sets it: its members, how
 * the store shares orders out, each member's pay from a date, their results
 * over a period, and a month's payroll. Results and payroll are read from
 * the order's own handling facts (who confirmed it, when it was delivered),
 * which the Event Log's pruning never touches; a missing rate is reported as
 * missing, never counted as zero.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders, storeTeamConfig, teamAgents, teamMemberships, teamPay, users, userScopes } from "../db/schema";
import { nextStoreDay, storeDateOf, storeDayOf, storeDayStart } from "../time/store-day";
import { SCOPES } from "../rbac/scopes";
import { DEFAULT_TEAM_CONFIG, PAY_KINDS, WAITING_STATUSES, type Distribution, type PayKind } from "./model";
import { TEAM_QUEUE_SQL } from "./queue";

/** Which orders a member's permissions let them work: every order, only theirs, or none. */
export type OrderReach = "all" | "own" | "none";

export interface TeamMemberRow {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  active: boolean;
  receiving: boolean;
  joinedAt: string;
  /** Orders with them that still wait: new, or the customer not reached. */
  waiting: number;
  /** Of those, the ones with a callback set. */
  callbacks: number;
  reach: OrderReach;
}

export async function listTeamMembers(db: AppDb): Promise<TeamMemberRow[]> {
  const rows = await db
    .select({
      userId: teamAgents.userId,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      receiving: teamAgents.receiving,
      joinedAt: teamAgents.createdAt,
      waiting: sql<number>`(select count(*) from orders w where w.assignee_id = ${teamAgents.userId} and w.status in ('new', 'unreachable') and w.archived_at is null)`,
      callbacks: sql<number>`(select count(*) from orders w where w.assignee_id = ${teamAgents.userId} and w.status in ('new', 'unreachable') and w.archived_at is null and w.callback_at is not null)`,
    })
    .from(teamAgents)
    .innerJoin(users, eq(users.id, teamAgents.userId))
    .orderBy(asc(users.name), asc(teamAgents.userId))
    .all();
  const reach = await orderReachOf(db, rows);
  return rows.map(({ status, ...row }) => ({ ...row, active: status === "active", waiting: Number(row.waiting), callbacks: Number(row.callbacks), reach: reach.get(row.userId) ?? "none" }));
}

export interface TeamCandidate {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  reach: OrderReach;
}

/** The store's active people who are not on the team yet: whom a manager can add. */
export async function listTeamCandidates(db: AppDb): Promise<TeamCandidate[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), sql`not exists (select 1 from team_agents a where a.user_id = ${users.id})`))
    .orderBy(asc(users.name), asc(users.id))
    .all();
  const reach = await orderReachOf(db, rows);
  return rows.map((row) => ({ ...row, reach: reach.get(row.userId) ?? "none" }));
}

async function orderReachOf(db: AppDb, members: Array<{ userId: string; role: "admin" | "staff" }>): Promise<Map<string, OrderReach>> {
  const staff = members.filter((m) => m.role !== "admin").map((m) => m.userId);
  const scopes = staff.length
    ? await db.select({ userId: userScopes.userId, scope: userScopes.scope }).from(userScopes).where(and(inArray(userScopes.userId, staff), inArray(userScopes.scope, [SCOPES.ALL, SCOPES.ORDERS_READ, SCOPES.ORDERS_READ_ASSIGNED]))).all()
    : [];
  const reach = new Map<string, OrderReach>(members.map((m) => [m.userId, m.role === "admin" ? "all" : "none"]));
  for (const { userId, scope } of scopes) {
    if (scope === SCOPES.ORDERS_READ || scope === SCOPES.ALL) reach.set(userId, "all");
    else if (reach.get(userId) === "none") reach.set(userId, "own");
  }
  return reach;
}

/**
 * What waits for someone to act: new orders with nobody, orders that moved
 * on as often as the store allows and wait for a manager, and orders still
 * waiting with someone who left the team or whose account is inactive.
 */
export async function teamQueue(db: AppDb): Promise<{ unassigned: number; needsManager: number; withFormerMembers: number }> {
  const row = await db
    .select({
      unassigned: sql<number>`sum(${TEAM_QUEUE_SQL.unassigned})`,
      needsManager: sql<number>`sum(${TEAM_QUEUE_SQL.needs_manager})`,
      withFormerMembers: sql<number>`sum(${TEAM_QUEUE_SQL.former})`,
    })
    .from(orders)
    .where(and(inArray(orders.status, WAITING_STATUSES), sql`${orders.archivedAt} is null`))
    .get();
  return { unassigned: Number(row?.unassigned ?? 0), needsManager: Number(row?.needsManager ?? 0), withFormerMembers: Number(row?.withFormerMembers ?? 0) };
}

export type TeamMembership = { ok: true } | { ok: false; reason: "user_not_found" | "already_member" | "not_member" };

export async function addTeamMember(db: AppDb, userId: string, receiving: boolean): Promise<TeamMembership> {
  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, reason: "user_not_found" };
  const now = new Date().toISOString();
  const added = await db.insert(teamAgents).values({ userId, receiving, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ userId: teamAgents.userId });
  return added.length ? { ok: true } : { ok: false, reason: "already_member" };
}

export async function setReceiving(db: AppDb, userId: string, receiving: boolean): Promise<TeamMembership> {
  const updated = await db.update(teamAgents).set({ receiving, updatedAt: new Date().toISOString() }).where(eq(teamAgents.userId, userId)).returning({ userId: teamAgents.userId });
  return updated.length ? { ok: true } : { ok: false, reason: "not_member" };
}

/** Takes a member off the team: they receive nothing more, the orders still waiting with them go back to the team by the store's rule (`shareOutWaiting`), and their pay is kept for past months. */
export async function removeTeamMember(db: AppDb, userId: string): Promise<TeamMembership> {
  const removed = await db.delete(teamAgents).where(eq(teamAgents.userId, userId)).returning({ userId: teamAgents.userId });
  return removed.length ? { ok: true } : { ok: false, reason: "not_member" };
}

export async function teamMembership(db: AppDb, userId: string): Promise<{ member: boolean; receiving: boolean }> {
  const row = await db.select({ receiving: teamAgents.receiving }).from(teamAgents).where(eq(teamAgents.userId, userId)).get();
  return { member: Boolean(row), receiving: row?.receiving ?? false };
}

export interface TeamConfig {
  distribution: Distribution;
  takeBackMinutes: number | null;
  takeBackLimit: number;
}

export async function getTeamConfig(db: AppDb): Promise<TeamConfig> {
  const row = await db.select({ distribution: storeTeamConfig.distribution, takeBackMinutes: storeTeamConfig.takeBackMinutes, takeBackLimit: storeTeamConfig.takeBackLimit }).from(storeTeamConfig).limit(1).get();
  return row ?? { ...DEFAULT_TEAM_CONFIG };
}

export async function setTeamConfig(db: AppDb, config: TeamConfig): Promise<TeamConfig> {
  const now = new Date().toISOString();
  await db
    .insert(storeTeamConfig)
    .values({ id: crypto.randomUUID(), storeId: sql`(select id from stores limit 1)`, ...config, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: storeTeamConfig.storeId, set: { ...config, updatedAt: now } });
  return getTeamConfig(db);
}

export interface PayRate {
  id: string;
  kind: PayKind;
  amount: number;
  validFrom: string;
}

/** A member's rates, each kind newest first. */
export async function listPay(db: AppDb, userId: string): Promise<PayRate[]> {
  return db.select({ id: teamPay.id, kind: teamPay.kind, amount: teamPay.amount, validFrom: teamPay.validFrom }).from(teamPay).where(eq(teamPay.userId, userId)).orderBy(asc(teamPay.kind), desc(teamPay.validFrom)).all();
}

/** Sets a rate from a date; the same kind from the same date is replaced. A salary applies from the first of a month. */
export async function setPay(db: AppDb, input: { userId: string; kind: PayKind; amount: number; validFrom: string; createdBy: string | null }): Promise<PayRate> {
  const validFrom = input.kind === "salary" ? `${input.validFrom.slice(0, 7)}-01` : input.validFrom;
  const row = await db
    .insert(teamPay)
    .values({ id: crypto.randomUUID(), userId: input.userId, kind: input.kind, amount: input.amount, validFrom, createdAt: new Date().toISOString(), createdBy: input.createdBy })
    .onConflictDoUpdate({ target: [teamPay.userId, teamPay.kind, teamPay.validFrom], set: { amount: input.amount, createdBy: input.createdBy } })
    .returning({ id: teamPay.id, kind: teamPay.kind, amount: teamPay.amount, validFrom: teamPay.validFrom })
    .get();
  return row;
}

export async function removePay(db: AppDb, id: string): Promise<{ userId: string; kind: PayKind; amount: number; validFrom: string } | null> {
  return (await db.delete(teamPay).where(eq(teamPay.id, id)).returning({ userId: teamPay.userId, kind: teamPay.kind, amount: teamPay.amount, validFrom: teamPay.validFrom }).get()) ?? null;
}

/** Whether `userId` is or ever was on the team: whose pay can be set, so a past month can be corrected after they leave. */
export async function wasEverOnTeam(db: AppDb, userId: string): Promise<boolean> {
  return Boolean(await db.select({ id: teamMemberships.id }).from(teamMemberships).where(eq(teamMemberships.userId, userId)).limit(1).get());
}

export interface MemberResults {
  userId: string;
  name: string;
  /** Orders placed in the period that are with them now. */
  assigned: number;
  waiting: number;
  confirmed: number;
  /** Cancelled without ever being confirmed. */
  cancelled: number;
  /** Of the confirmed: delivered, or come back. */
  delivered: number;
  returned: number;
  /** Confirmed out of those decided (confirmed or cancelled); null before any. A whole percent. */
  confirmationRate: number | null;
  /** Delivered out of those whose delivery ended; null before any. A whole percent. */
  deliveryRate: number | null;
  /** On average, minutes from getting an order to their first decision on it; null when they made none. */
  minutesToDecide: number | null;
  /** Of the cancelled: those cancelled after at least one call without an answer. */
  cancelledAfterNoAnswer: number;
  /** The calls without an answer those orders had: divided by them, how many times they were called before cancelling. */
  noAnswerCallsBeforeCancel: number;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Each member's results for orders placed from `from` to `to` (store days,
 * both included): the orders with them now, and what became of them.
 */
export async function teamResults(db: AppDb, from: string, to: string): Promise<MemberResults[]> {
  const rows = await db
    .select({
      userId: sql<string>`${orders.assigneeId}`,
      name: sql<string | null>`(select u.name from users u where u.id = ${orders.assigneeId})`,
      assigned: sql<number>`count(*)`,
      waiting: sql<number>`sum(${orders.status} in ('new', 'unreachable'))`,
      confirmed: sql<number>`sum(${orders.confirmedAt} is not null)`,
      cancelled: sql<number>`sum(${orders.status} = 'cancelled' and ${orders.confirmedAt} is null)`,
      delivered: sql<number>`sum(${orders.confirmedAt} is not null and exists (select 1 from shipments s where s.order_id = orders.id and s.delivered_at is not null))`,
      returned: sql<number>`sum(${orders.confirmedAt} is not null and exists (select 1 from shipments s where s.order_id = orders.id and s.returned_at is not null))`,
      minutesToDecide: sql<number | null>`avg(case when ${orders.decidedBy} = ${orders.assigneeId} and ${orders.decidedAt} >= ${orders.assignedAt} then (julianday(${orders.decidedAt}) - julianday(${orders.assignedAt})) * 1440 end)`,
      cancelledAfterNoAnswer: sql<number>`sum(${orders.status} = 'cancelled' and ${orders.confirmedAt} is null and ${orders.unansweredCalls} > 0)`,
      noAnswerCallsBeforeCancel: sql<number>`sum(case when ${orders.status} = 'cancelled' and ${orders.confirmedAt} is null then ${orders.unansweredCalls} else 0 end)`,
    })
    .from(orders)
    .where(and(sql`${orders.assigneeId} is not null`, sql`${orders.createdAt} >= ${storeDayStart(from)}`, sql`${orders.createdAt} < ${storeDayStart(nextStoreDay(to))}`))
    .groupBy(orders.assigneeId)
    .all();
  return rows.map((row) => {
    const n = (value: unknown) => Number(value ?? 0);
    const [confirmed, cancelled, delivered, returned] = [n(row.confirmed), n(row.cancelled), n(row.delivered), n(row.returned)];
    return {
      userId: row.userId,
      name: row.name ?? row.userId,
      assigned: n(row.assigned),
      waiting: n(row.waiting),
      confirmed,
      cancelled,
      delivered,
      returned,
      confirmationRate: percent(confirmed, confirmed + cancelled),
      deliveryRate: percent(delivered, delivered + returned),
      minutesToDecide: row.minutesToDecide == null ? null : Math.round(Number(row.minutesToDecide)),
      cancelledAfterNoAnswer: n(row.cancelledAfterNoAnswer),
      noAnswerCallsBeforeCancel: n(row.noAnswerCallsBeforeCancel),
    };
  });
}

export interface PayrollLine {
  userId: string;
  name: string;
  /** True when they were on the team at some point in the month. */
  onTeam: boolean;
  /** The store day they joined, when it fell in the month. */
  joinedOn: string | null;
  /** The store day they left, when it fell in the month. */
  leftOn: string | null;
  /** False when no pay of any kind was ever set for them. */
  paySet: boolean;
  /** The salary in force that month, paid whole; null when they have none, or were not on the team. */
  salary: number | null;
  /** Orders they confirmed this month, the commission on them, and how many fell before their first rate of that kind. */
  confirmed: { orders: number; amount: number; unpriced: number };
  /** Orders they confirmed that were delivered this month. */
  delivered: { orders: number; amount: number; unpriced: number };
  /** Salary plus commissions; what is unpriced is not in it. */
  total: number;
  /** True when something is missing: a member with no pay set, or orders with no rate in force for a kind they are paid. */
  incomplete: boolean;
}

/**
 * A month's payroll (YYYY-MM). It lists everyone who was on the team at
 * some point in the month, and anyone with pay set who was credited with
 * work in it. A salary starts on the first of a month, so a member is paid
 * the one in force that month, whole, even if they joined or left during
 * it; the day they joined or left is given so the merchant sees it.
 * Commissions are on the orders they confirmed in the month and on those
 * delivered in it, each at the rate in force on its day. A kind of pay a
 * member does not have counts nothing and misses nothing. Who is on the
 * team now never changes a past month.
 */
export async function payroll(db: AppDb, month: string): Promise<PayrollLine[]> {
  const first = `${month}-01`;
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const start = storeDayStart(first);
  const end = storeDayStart(nextMonth);
  const rate = (kind: PayKind, member: string, day: SQLChunk) =>
    sql`(select p.amount from team_pay p where p.user_id = ${sql.raw(member)} and p.kind = ${kind} and p.valid_from <= ${day} order by p.valid_from desc limit 1)`;

  const [confirmations, deliveries, salaries, kinds, stints] = await db.batch([
    db
      .select({
        userId: sql<string>`o.confirmed_by`,
        orders: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${rate("per_confirmed", "o.confirmed_by", storeDateOf("o.confirmed_at"))}), 0)`,
        unpriced: sql<number>`sum(${rate("per_confirmed", "o.confirmed_by", storeDateOf("o.confirmed_at"))} is null)`,
      })
      .from(sql`orders o`)
      .where(sql`o.confirmed_at >= ${start} and o.confirmed_at < ${end} and o.confirmed_by is not null`)
      .groupBy(sql`o.confirmed_by`),
    db
      .select({
        userId: sql<string>`o.confirmed_by`,
        orders: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${rate("per_delivered", "o.confirmed_by", storeDateOf("s.delivered_at"))}), 0)`,
        unpriced: sql<number>`sum(${rate("per_delivered", "o.confirmed_by", storeDateOf("s.delivered_at"))} is null)`,
      })
      .from(sql`shipments s join orders o on o.id = s.order_id`)
      .where(sql`s.delivered_at >= ${start} and s.delivered_at < ${end} and o.confirmed_by is not null`)
      .groupBy(sql`o.confirmed_by`),
    db
      .select({ userId: teamPay.userId, amount: teamPay.amount })
      .from(teamPay)
      .where(and(eq(teamPay.kind, "salary"), sql`${teamPay.validFrom} < ${nextMonth}`))
      .orderBy(asc(teamPay.userId), desc(teamPay.validFrom)),
    db.selectDistinct({ userId: teamPay.userId, kind: teamPay.kind }).from(teamPay),
    db
      .select({
        userId: teamMemberships.userId,
        joinedAt: sql<string>`min(${teamMemberships.joinedAt})`,
        leftAt: sql<string | null>`case when sum(${teamMemberships.leftAt} is null) > 0 then null else max(${teamMemberships.leftAt}) end`,
      })
      .from(teamMemberships)
      .where(and(sql`${teamMemberships.joinedAt} < ${end}`, sql`(${teamMemberships.leftAt} is null or ${teamMemberships.leftAt} >= ${start})`))
      .groupBy(teamMemberships.userId),
  ]);

  const paidBy = new Set(kinds.map((row) => `${row.userId}:${row.kind}`));
  const paid = new Set(kinds.map((row) => row.userId));
  const stintOf = new Map(stints.map((row) => [row.userId, row]));
  const confirmedOf = new Map(confirmations.map((r) => [r.userId, r]));
  const deliveredOf = new Map(deliveries.map((r) => [r.userId, r]));
  const credited = [...confirmedOf.keys(), ...deliveredOf.keys()].filter((userId) => paid.has(userId));
  const ids = [...new Set([...stintOf.keys(), ...credited])];
  const names = ids.length ? new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).all()).map((u) => [u.id, u.name])) : new Map<string, string>();

  const salaryOf = (userId: string) => salaries.find((row) => row.userId === userId)?.amount ?? null;
  const part = (userId: string, kind: PayKind, row: { orders: number; amount: number; unpriced: number } | undefined) => ({
    orders: Number(row?.orders ?? 0),
    amount: Number(row?.amount ?? 0),
    unpriced: paidBy.has(`${userId}:${kind}`) ? Number(row?.unpriced ?? 0) : 0,
  });
  return ids
    .map((userId): PayrollLine => {
      const stint = stintOf.get(userId);
      const joinedOn = stint && stint.joinedAt >= start ? storeDayOf(stint.joinedAt) : null;
      const leftOn = stint?.leftAt && stint.leftAt < end ? storeDayOf(stint.leftAt) : null;
      const paySet = PAY_KINDS.some((kind) => paidBy.has(`${userId}:${kind}`));
      const salary = stint ? salaryOf(userId) : null;
      const confirmed = part(userId, "per_confirmed", confirmedOf.get(userId));
      const delivered = part(userId, "per_delivered", deliveredOf.get(userId));
      return {
        userId,
        name: names.get(userId) ?? userId,
        onTeam: Boolean(stint),
        joinedOn,
        leftOn,
        paySet,
        salary,
        confirmed,
        delivered,
        total: (salary ?? 0) + confirmed.amount + delivered.amount,
        incomplete: (Boolean(stint) && !paySet) || confirmed.unpriced > 0 || delivered.unpriced > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

type SQLChunk = ReturnType<typeof sql.raw>;

