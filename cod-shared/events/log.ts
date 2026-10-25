/**
 * The Event Log (Events context): the store's Business Events, each in the one
 * shape every reader receives it — a Consumer, the merchant's API, the
 * dashboard — and read in Sequence order.
 */

import { and, asc, desc, eq, gt, inArray, lt, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { businessEvents } from "../db/schema";
import type { Actor, Origin } from "./actor";
import { EVENT_TYPES, type EventDataMap, type EventSubject, type EventType } from "./catalogue";
import { subscribesTo, type SubscriptionPattern } from "./subscription";

/** A Business Event as it is published: its envelope, and the data its type and version promise. */
export type BusinessEvent = {
  [T in EventType]: {
    id: string;
    sequence: number;
    type: T;
    version: number;
    subject: { type: EventSubject; id: string };
    orderId: string;
    occurredAt: string;
    recordedAt: string;
    actor: Actor;
    origin: Origin;
    data: EventDataMap[T];
  };
}[EventType];

export function toBusinessEvent(row: typeof businessEvents.$inferSelect): BusinessEvent {
  return {
    id: row.id,
    sequence: row.seq,
    type: row.type,
    version: row.version,
    subject: { type: row.subjectType, id: row.subjectId },
    orderId: row.orderId,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    actor: { kind: row.actorKind, id: row.actorId, name: row.actorName } as Actor,
    origin: row.origin,
    data: JSON.parse(row.data),
  } as BusinessEvent;
}

export const EVENT_LOG_PAGE_MAX = 100;

/**
 * Which page of the Event Log: `after` a Sequence reads forward, oldest first
 * — how an integration follows the log; otherwise newest first, `before` a
 * Sequence when given. Never both.
 */
export interface EventLogQuery {
  after?: number;
  before?: number;
  limit: number;
  /** Event Types as a Subscription names them; none means every type. */
  types?: readonly SubscriptionPattern[];
  orderId?: string;
}

export interface EventLogPage {
  events: BusinessEvent[];
  /** The Sequence to read on from — as `after` or `before`, the way this page was asked — or null at the end. */
  next: number | null;
}

export async function readEventLog(db: AppDb, query: EventLogQuery): Promise<EventLogPage> {
  if (query.after !== undefined && query.before !== undefined) throw new Error("An Event Log page is read after a Sequence or before one, never both");
  const limit = Math.min(Math.max(1, Math.trunc(query.limit)), EVENT_LOG_PAGE_MAX);
  const forward = query.after !== undefined;
  const where: SQL[] = [];
  if (forward) where.push(gt(businessEvents.seq, query.after!));
  if (query.before !== undefined) where.push(lt(businessEvents.seq, query.before));
  if (query.types?.length) where.push(inArray(businessEvents.type, EVENT_TYPES.filter((type) => subscribesTo(query.types!, type))));
  if (query.orderId !== undefined) where.push(eq(businessEvents.orderId, query.orderId));
  const rows = await db
    .select()
    .from(businessEvents)
    .where(where.length ? and(...where) : undefined)
    .orderBy(forward ? asc(businessEvents.seq) : desc(businessEvents.seq))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  return { events: page.map(toBusinessEvent), next: rows.length > limit ? page.at(-1)!.seq : null };
}

export async function readBusinessEvent(db: AppDb, id: string): Promise<BusinessEvent | null> {
  const row = await db.select().from(businessEvents).where(eq(businessEvents.id, id)).get();
  return row ? toBusinessEvent(row) : null;
}
