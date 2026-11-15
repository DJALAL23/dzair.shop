/**
 * Giving orders to the confirmation team (CONTEXT.md: Assignment). The
 * store's rule picks the member in SQL, inside the statement that gives the
 * order, so two orders placed at once never race for the same turn. Every
 * change records `order.assigned` or `order.unassigned` in its own batch, while
 * the change's revision stands.
 */

import { and, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders, storeTeamConfig, teamAgents, users } from "../db/schema";
import { recordEvent } from "../events/record";
import { orderSnapshot, SqlJson } from "../events/snapshots";
import { staffOf, type Author } from "../events/actor";
import { chunkIds } from "../queries/d1-limits";
import { DEFAULT_TEAM_CONFIG, WAITING_STATUSES, type AssignmentWay } from "./model";
import { heldByFormerMember } from "./queue";
import { SCOPES } from "../rbac/scopes";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

const distribution = sql`coalesce((select distribution from store_team_config limit 1), ${DEFAULT_TEAM_CONFIG.distribution})`;

/** Whether a user can see orders, and so work one given to them: an admin, or staff with any orders permission. */
export function seesOrders(userId: SQL): SQL {
  return sql`(exists (select 1 from users r where r.id = ${userId} and r.role = 'admin') or exists (select 1 from user_scopes s where s.user_id = ${userId} and s.scope in (${SCOPES.ALL}, ${SCOPES.ORDERS_READ}, ${SCOPES.ORDERS_READ_ASSIGNED})))`;
}

/**
 * The member the store's rule gives the next order to, or null: nobody when
 * orders are shared out by hand, or when no active member who can see orders
 * is receiving.
 * `in_turn` gives it to whoever got one longest ago (a newcomer first: SQLite
 * sorts a null first);
 * `evenly` to whoever has the fewest orders waiting, then in turn.
 */
export function nextAssigneeSql(except?: SQL | string | null): SQL {
  const notThem = except == null ? sql`` : sql`and a.user_id <> ${except}`;
  return sql`(select a.user_id from team_agents a join users u on u.id = a.user_id
    where a.receiving = 1 and u.status = 'active' and ${distribution} <> 'manual' ${notThem}
      and ${seesOrders(sql`a.user_id`)}
    order by
      case when ${distribution} = 'evenly' then (select count(*) from orders w where w.assignee_id = a.user_id and w.status in ('new', 'unreachable')) else 0 end,
      a.turn, a.user_id
    limit 1)`;
}

/** The member as an event names them: id and name, or null. */
const memberJson = (userId: SQL) => new SqlJson<{ id: string; name: string } | null>(sql`(select json_object('id', u.id, 'name', u.name) from users u where u.id = ${userId})`);
const assigneeOf = (orderId: string) => sql`(select assignee_id from orders where id = ${orderId})`;
const standsAt = (orderId: string, revision: string) => sql`exists (select 1 from ${orders} where ${orders.id} = ${orderId} and ${orders.revision} = ${revision})`;

/**
 * The assignee of a new order, for its insert: an order a team member enters
 * is theirs; any other goes by the store's rule.
 */
export function assignmentOnCreate(author: Author, now: string): { assigneeId: SQL; assignedAt: SQL } {
  const staff = staffOf(author.actor);
  const assignee = staff ? sql`coalesce((select user_id from team_agents where user_id = ${staff.id}), ${nextAssigneeSql()})` : nextAssigneeSql();
  return { assigneeId: assignee, assignedAt: sql`case when ${assignee} is not null then ${now} end` };
}

/** `order.assigned` for a new order, recorded only when it was given to someone. */
export function assignedOnCreate(db: AppDb, orderId: string, now: string, author: Author): BatchStatement {
  return recordEvent(
    db,
    {
      type: "order.assigned",
      subjectId: orderId,
      orderId,
      occurredAt: now,
      actor: { kind: "system", id: null, name: null },
      origin: author.origin,
      data: { order: orderSnapshot(orderId), assignee: memberJson(assigneeOf(orderId)) as SqlJson<{ id: string; name: string }>, previousAssignee: null, way: "automatic" },
    },
    sql`${assigneeOf(orderId)} is not null`,
  );
}

/** The statements that move one order, read as `from`, to `to` (null: to nobody), while it still stands as read. */
function moveStatements(
  db: AppDb,
  move: { orderId: string; from: string | null; fromAt?: string | null; to: SQL | string | null; way: AssignmentWay; now: string; author: Author; when?: SQL },
): BatchStatement[] {
  const revision = crypto.randomUUID();
  const to = move.to == null ? null : typeof move.to === "string" ? sql`${move.to}` : move.to;
  const stands = [
    eq(orders.id, move.orderId),
    move.from == null ? isNull(orders.assigneeId) : eq(orders.assigneeId, move.from),
    ...(move.fromAt === undefined ? [] : [move.fromAt == null ? isNull(orders.assignedAt) : eq(orders.assignedAt, move.fromAt)]),
    ...(to ? [sql`${to} is not null`] : []),
    ...(move.when ? [move.when] : []),
  ];
  const previous = memberJson(sql`${move.from}`);
  return [
    db
      .update(orders)
      .set({
        assigneeId: to ?? null,
        assignedAt: to ? move.now : null,
        takeBacks: move.way === "take_back" ? sql`${orders.takeBacks} + 1` : 0,
        revision,
      })
      .where(and(...stands)),
    to
      ? recordEvent(
          db,
          {
            type: "order.assigned",
            subjectId: move.orderId,
            orderId: move.orderId,
            occurredAt: move.now,
            ...(move.way === "manual" ? move.author : { actor: { kind: "system", id: null, name: null }, origin: move.author.origin }),
            data: { order: orderSnapshot(move.orderId), assignee: memberJson(assigneeOf(move.orderId)) as SqlJson<{ id: string; name: string }>, previousAssignee: move.from ? previous : null, way: move.way },
          },
          standsAt(move.orderId, revision),
        )
      : recordEvent(
          db,
          {
            type: "order.unassigned",
            subjectId: move.orderId,
            orderId: move.orderId,
            occurredAt: move.now,
            ...move.author,
            data: { order: orderSnapshot(move.orderId), previousAssignee: previous as SqlJson<{ id: string; name: string }> },
          },
          standsAt(move.orderId, revision),
        ),
  ];
}

const changed = (result: unknown) => ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;

export type AssignmentResult = { orderId: string; ok: true; changed: boolean } | { orderId: string; ok: false; reason: "order_not_found" | "decided" | "changed" };
export type AssignRefusal = { ok: false; reason: "member_not_found" | "member_inactive" | "not_member" | "no_order_access" };

/**
 * A manager gives orders to a member who can see them, or to nobody
 * (`to: null`), or shares them out by the store's rule (`to: "rule"`). Only
 * an order still waiting to be confirmed moves: once confirmed or cancelled,
 * who handled it stays the record. Each order is moved only while it is
 * still with whoever it was with when read; one already with that member is
 * left as it is. One result per order id, in the order given.
 */
export async function assignOrders(
  db: AppDb,
  orderIds: string[],
  to: string | null | "rule",
  author: Author,
): Promise<AssignRefusal | { ok: true; results: AssignmentResult[] }> {
  if (typeof to === "string" && to !== "rule") {
    const member = await db.select({ status: users.status, sees: sql<number>`${seesOrders(sql`${users.id}`)}` }).from(users).where(eq(users.id, to)).get();
    if (!member) return { ok: false, reason: "member_not_found" };
    if (member.status !== "active") return { ok: false, reason: "member_inactive" };
    if (!(await isTeamMember(db, to))) return { ok: false, reason: "not_member" };
    if (!member.sees) return { ok: false, reason: "no_order_access" };
  }
  const distinct = [...new Set(orderIds)];
  const found = new Map<string, string | null>();
  const decided = new Set<string>();
  for (const chunk of chunkIds(distinct)) {
    for (const row of await db.select({ id: orders.id, assigneeId: orders.assigneeId, status: orders.status }).from(orders).where(inArray(orders.id, chunk)).all()) {
      found.set(row.id, row.assigneeId);
      if (!(WAITING_STATUSES as readonly string[]).includes(row.status)) decided.add(row.id);
    }
  }
  const now = new Date().toISOString();
  const moves = distinct.filter((id) => found.has(id) && !decided.has(id) && (to === "rule" || found.get(id) !== to));
  const statements = moves.flatMap((orderId) =>
    moveStatements(db, { orderId, from: found.get(orderId) ?? null, to: to === "rule" ? nextAssigneeSql(found.get(orderId)) : to, way: to === "rule" ? "automatic" : "manual", now, author, when: inArray(orders.status, WAITING_STATUSES) }),
  );
  const results = statements.length ? await db.batch(statements as [BatchStatement, ...BatchStatement[]]) : [];
  const moved = new Map(moves.map((orderId, i) => [orderId, changed(results[i * 2])]));
  return {
    ok: true,
    results: orderIds.map((orderId): AssignmentResult => {
      if (!found.has(orderId)) return { orderId, ok: false, reason: "order_not_found" };
      if (decided.has(orderId)) return { orderId, ok: false, reason: "decided" };
      if (!moved.has(orderId)) return { orderId, ok: true, changed: false };
      return moved.get(orderId) ? { orderId, ok: true, changed: true } : to === "rule" ? { orderId, ok: true, changed: false } : { orderId, ok: false, reason: "changed" };
    }),
  };
}

/** Orders shared out or taken back in one run: a run is bounded, the next one goes on. */
export const ORDERS_PER_RUN = 50;

/**
 * Orders nobody is working, given out by the store's rule, oldest first: new
 * orders that arrived while nobody was receiving, and orders still waiting
 * with someone who left the team or whose account was made inactive. Run
 * when a member starts receiving or leaves, and by the schedule. Under
 * `manual` nothing moves.
 */
export async function shareOutWaiting(db: AppDb, now: Date, author: Author, perRun = ORDERS_PER_RUN): Promise<number> {
  const unassigned = and(eq(orders.status, "new"), isNull(orders.assigneeId));
  const waiting = await db
    .select({ id: orders.id, assigneeId: orders.assigneeId })
    .from(orders)
    .where(and(inArray(orders.status, WAITING_STATUSES), isNull(orders.archivedAt), sql`(${unassigned} or ${heldByFormerMember})`, sql`${nextAssigneeSql()} is not null`))
    .orderBy(orders.createdAt, orders.id)
    .limit(perRun)
    .all();
  if (waiting.length === 0) return 0;
  const at = now.toISOString();
  const statements = waiting.flatMap(({ id, assigneeId }) =>
    moveStatements(db, {
      orderId: id,
      from: assigneeId,
      to: nextAssigneeSql(),
      way: "automatic",
      now: at,
      author,
      when: assigneeId === null ? eq(orders.status, "new") : and(inArray(orders.status, WAITING_STATUSES), heldByFormerMember),
    }),
  );
  const results = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return waiting.filter((_, i) => changed(results[i * 2])).length;
}

/**
 * Orders a member left untouched — still `new`, no callback set — for the
 * store's take-back minutes move to the next member, up to its limit; then
 * they stay and wait for a manager (`takeBacks` = the limit). Off while the
 * store has no take-back minutes. When nobody else is receiving, the order
 * stays where it is.
 */
export async function takeBackUntouched(db: AppDb, now: Date, author: Author, perRun = ORDERS_PER_RUN): Promise<number> {
  const config = await db.select({ minutes: storeTeamConfig.takeBackMinutes, limit: storeTeamConfig.takeBackLimit }).from(storeTeamConfig).limit(1).get();
  if (!config?.minutes) return 0;
  const due = await db
    .select({ id: orders.id, assigneeId: orders.assigneeId, assignedAt: orders.assignedAt })
    .from(orders)
    .where(
      and(
        eq(orders.status, "new"),
        isNull(orders.callbackAt),
        isNull(orders.archivedAt),
        sql`${orders.assigneeId} is not null`,
        lte(orders.assignedAt, new Date(now.getTime() - config.minutes * 60_000).toISOString()),
        sql`${orders.takeBacks} < ${config.limit}`,
      ),
    )
    .orderBy(orders.assignedAt, orders.id)
    .limit(perRun)
    .all();
  if (due.length === 0) return 0;
  const at = now.toISOString();
  const statements = due.flatMap((order) =>
    moveStatements(db, {
      orderId: order.id,
      from: order.assigneeId,
      fromAt: order.assignedAt,
      to: nextAssigneeSql(order.assigneeId),
      way: "take_back",
      now: at,
      author,
      when: and(eq(orders.status, "new"), isNull(orders.callbackAt), sql`${orders.takeBacks} < ${config.limit}`),
    }),
  );
  const results = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return due.filter((_, i) => changed(results[i * 2])).length;
}

/** Whether `userId` is on the team (whatever their receiving). */
export async function isTeamMember(db: AppDb, userId: string): Promise<boolean> {
  return Boolean(await db.select({ userId: teamAgents.userId }).from(teamAgents).where(eq(teamAgents.userId, userId)).get());
}

export { WAITING_STATUSES };
