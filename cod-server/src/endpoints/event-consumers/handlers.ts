import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import { sendTestEvent } from "@/events/consumers/webhook";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { WEBHOOK_CONSUMERS_MAX, WEBHOOK_KIND } from "../../../../cod-shared/events/webhooks";
import {
  createWebhookConsumer,
  deleteConsumer,
  listConsumers,
  readConsumer,
  replayToConsumer,
  rotateSigningSecret,
  updateConsumer,
} from "../../../../cod-shared/events/consumers";
import type { consumerChangeSchema, replaySchema, testEventSchema, webhookCreateSchema } from "./validation";
import { consumerWithAccess, readableKinds } from "./access";

const idOf = (c: Context<AppContext>) => ((c.req as any).valid("param") as { id: string }).id;
const bodyOf = <T extends z.ZodType>(c: Context<AppContext>) => (c.req as any).valid("json") as z.output<T>;

/** A refusal the Consumer's kind gives: what is not found, and what a built-in Consumer is not open to. */
function refused(reason: "not_found" | "built_in", id: string, builtIn: string): never {
  if (reason === "not_found") throw new NotFoundError("Event Consumer", id);
  throw new ConflictError(builtIn, ERROR_CODES.EVENT_CONSUMER_BUILT_IN);
}

export async function listEventConsumers(c: Context<AppContext>) {
  const consumers = await listConsumers(getDb(c.env.DB), readableKinds(c));
  return c.json({ success: true, data: consumers, count: consumers.length }, 200);
}

export async function createEventConsumer(c: Context<AppContext>) {
  const { name, url, subscription } = bodyOf<typeof webhookCreateSchema>(c);
  const db = getDb(c.env.DB);
  const created = await createWebhookConsumer(db, { name, url, subscription }, new Date());
  if (!created.ok) throw new ConflictError(`The store already has ${WEBHOOK_CONSUMERS_MAX} webhooks: delete one first`, ERROR_CODES.EVENT_CONSUMER_LIMIT_REACHED);
  const { consumer } = created;
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_CREATED, { type: "event_consumer", id: consumer.id, label: consumer.name }, { url, subscription: consumer.subscription });
  return c.json({ success: true, data: { consumer, signingSecret: created.signingSecret } }, 201);
}

export async function getEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const db = getDb(c.env.DB);
  await consumerWithAccess(c, db, id, "read");
  const consumer = await readConsumer(db, id);
  if (!consumer) throw new NotFoundError("Event Consumer", id);
  return c.json({ success: true, data: consumer }, 200);
}

export async function updateEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const { enabled, ...edits } = bodyOf<typeof consumerChangeSchema>(c);
  const db = getDb(c.env.DB);
  await consumerWithAccess(c, db, id, "manage");
  const updated = await updateConsumer(db, id, { enabled, ...edits }, new Date());
  if (!updated.ok) refused(updated.reason, id, "This Consumer is kept by its App: it can only be started or stopped");
  const { consumer } = updated;
  const target = { type: "event_consumer", id, label: consumer.name };
  const edited = Object.fromEntries(Object.entries(edits).filter(([, value]) => value !== undefined));
  if (Object.keys(edited).length > 0) await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_UPDATED, target, edited);
  if (enabled !== undefined) await logActivity(db, c.get("user"), enabled ? ACTIONS.EVENT_CONSUMER_ENABLED : ACTIONS.EVENT_CONSUMER_DISABLED, target);
  return c.json({ success: true, data: consumer }, 200);
}

export async function deleteEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const db = getDb(c.env.DB);
  await consumerWithAccess(c, db, id, "manage");
  const deleted = await deleteConsumer(db, id);
  if (!deleted.ok) refused(deleted.reason, id, "This Consumer is kept by its App: stop it instead");
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_DELETED, { type: "event_consumer", id, label: deleted.name });
  return c.json({ success: true, message: "Webhook deleted" }, 200);
}

export async function rotateEventConsumerSecret(c: Context<AppContext>) {
  const id = idOf(c);
  const db = getDb(c.env.DB);
  await consumerWithAccess(c, db, id, "manage");
  const rotated = await rotateSigningSecret(db, id, new Date());
  if (!rotated.ok) refused(rotated.reason, id, "Only a webhook has a Signing Secret");
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_SECRET_ROTATED, { type: "event_consumer", id }, { previousSecretSignsUntil: rotated.previousSecretSignsUntil });
  return c.json({ success: true, data: { signingSecret: rotated.signingSecret, previousSecretSignsUntil: rotated.previousSecretSignsUntil } }, 200);
}

export async function testEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const { type = "order.created" } = bodyOf<typeof testEventSchema>(c) ?? {};
  const db = getDb(c.env.DB);
  const consumer = await consumerWithAccess(c, db, id, "manage");
  if (consumer.kind !== WEBHOOK_KIND) throw new ConflictError("Only a webhook is sent Test Events", ERROR_CODES.EVENT_CONSUMER_BUILT_IN);
  const test = await sendTestEvent(consumer, type, fetch, new Date());
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_TESTED, { type: "event_consumer", id, label: consumer.name }, { type, outcome: test.outcome, httpStatus: test.httpStatus });
  return c.json({ success: true, data: test }, 200);
}

export async function replayEventConsumer(c: Context<AppContext>) {
  const id = idOf(c);
  const range = bodyOf<typeof replaySchema>(c);
  const db = getDb(c.env.DB);
  await consumerWithAccess(c, db, id, "manage");
  const replay = await replayToConsumer(db, id, range, new Date());
  if (!replay.ok) {
    if (replay.reason === "not_found") throw new NotFoundError("Event Consumer", id);
    throw new ConflictError("This Consumer is stopped: start it before replaying to it", ERROR_CODES.EVENT_CONSUMER_DISABLED);
  }
  await logActivity(db, c.get("user"), ACTIONS.EVENT_CONSUMER_REPLAYED, { type: "event_consumer", id }, { ...range, reopened: replay.reopened, created: replay.created });
  return c.json({ success: true, data: { reopened: replay.reopened, created: replay.created } }, 202);
}
