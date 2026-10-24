/**
 * Recording a Business Event (ADR 0016). A writer adds this statement to the
 * batch that makes its change, guarded by the same claim, so the event is
 * written exactly when the change commits: never for a change that lost its
 * race, never missing from one that happened.
 */

import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { insertSelectRow } from "../db/insert-select";
import { businessEvents } from "../db/schema";
import { EVENT_CATALOGUE, type BusinessEventDraft } from "./catalogue";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * The statement that records `event`. With `when`, it writes only while that
 * condition holds as the batch runs — pass the writer's own claim.
 */
export function recordEvent(db: AppDb, event: BusinessEventDraft, when?: SQL): BatchStatement {
  const { subject, version } = EVENT_CATALOGUE[event.type];
  return db.insert(businessEvents).select(
    db
      .select(
        insertSelectRow(businessEvents, {
          id: sql`${crypto.randomUUID()}`,
          type: sql`${event.type}`,
          version: sql`${version}`,
          subjectType: sql`${subject}`,
          subjectId: sql`${event.subjectId}`,
          orderId: sql`${event.orderId}`,
          actorKind: sql`${event.actor.kind}`,
          actorId: sql`${event.actor.id}`,
          actorName: sql`${event.actor.name}`,
          origin: sql`${event.origin}`,
          occurredAt: sql`${event.occurredAt}`,
          recordedAt: sql`${new Date().toISOString()}`,
          data: sql`${JSON.stringify(event.data)}`,
        }) as never,
      )
      .from(sql`(select 1)`)
      .where(when ?? sql`1`),
  );
}
