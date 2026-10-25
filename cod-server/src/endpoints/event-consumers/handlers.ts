import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { listConsumers, readConsumer, replayToConsumer, setConsumerEnabled } from "../../../../cod-shared/events/consumers";
import type { consumerChangeSchema, replaySchema } from "./validation";

const idOf = (c: Context<AppContext>) => ((c.req as any).valid("param") as { id: string }).id;

export async function listEventConsumers(c: Context<AppContext>) {
  const consumers = await listConsumers(getDb(c.env.DB));
  return c.json({ success: true, data: consumers, count: consumers.length }, 200);
}

export async function getEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const consumer = await readConsumer(getDb(c.env.DB), id);
  if (!consumer) throw new NotFoundError("Event Consumer", id);
  return c.json({ success: true, data: consumer }, 200);
}

export async function updateEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const { enabled } = (c.req as any).valid("json") as z.output<typeof consumerChangeSchema>;
  const db = getDb(c.env.DB);
  const consumer = await setConsumerEnabled(db, id, enabled, new Date());
  if (!consumer) throw new NotFoundError("Event Consumer", id);
  await logActivity(db, c.get("user"), enabled ? ACTIONS.EVENT_CONSUMER_ENABLED : ACTIONS.EVENT_CONSUMER_DISABLED, { type: "event_consumer", id, label: consumer.name });
  return c.json({ success: true, data: consumer }, 200);
}

export async function replayEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const range = (c.req as any).valid("json") as z.output<typeof replaySchema>;
  const db = getDb(c.env.DB);
  const replay = await replayToConsumer(db, id, range, new Date());
  if (!replay.ok) {
    if (replay.reason === "not_found") throw new NotFoundError("Event Consumer", id);
    throw new ConflictError("This Consumer is stopped: start it before replaying to it", ERROR_CODES.EVENT_CONSUMER_DISABLED);
  }
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_REPLAYED, { type: "event_consumer", id }, { ...range, reopened: replay.reopened, created: replay.created });
  return c.json({ success: true, data: { reopened: replay.reopened, created: replay.created } }, 202);
}
