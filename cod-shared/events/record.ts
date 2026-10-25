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
import { SqlJson } from "./snapshots";

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
          // D1's clock as the row is written, so Recorded At never runs backwards against the Sequence.
          recordedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          data: dataSql(event.data),
        }) as never,
      )
      .from(sql`(select 1)`)
      .where(when ?? sql`1`),
  );
}

/** The data as one JSON value: plain parts as written, snapshots as D1 builds them. */
function dataSql(data: BusinessEventDraft["data"]): SQL {
  const fields = Object.entries(data).map(([key, part]) => sql`${key}, json(${part instanceof SqlJson ? part.sql : JSON.stringify(part)})`);
  return sql`json_object(${sql.join(fields, sql`, `)})`;
}
