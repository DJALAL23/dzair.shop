import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { listDeliveries, readDelivery, retryDelivery } from "../../../../cod-shared/events/consumers";
import type { deliveryListQuerySchema } from "./validation";

const idOf = (c: Context<AppContext>) => ((c.req as any).valid("param") as { id: string }).id;

export async function listEventDeliveries(c: Context<AppContext>) {
  const { consumerId, eventId, ...rest } = (c.req as any).valid("query") as z.output<typeof deliveryListQuerySchema>;
  const page = await listDeliveries(getDb(c.env.DB), consumerId !== undefined ? { ...rest, consumerId } : { ...rest, eventId: eventId! });
  return c.json({ success: true, data: page.deliveries, count: page.deliveries.length, nextCursor: page.next }, 200);
}

export async function getEventDelivery(c: Context<AppContext>) {
  const id = idOf(c);
  const delivery = await readDelivery(getDb(c.env.DB), id);
  if (!delivery) throw new NotFoundError("Event Delivery", id);
  return c.json({ success: true, data: delivery }, 200);
}

export async function retryEventDelivery(c: Context<AppContext>) {
  const id = idOf(c);
  const db = getDb(c.env.DB);
  const retry = await retryDelivery(db, id, new Date());
  if (!retry.ok) {
    if (retry.reason === "not_found") throw new NotFoundError("Event Delivery", id);
    if (retry.reason === "consumer_disabled") throw new ConflictError("Its Consumer is stopped: start it before retrying", ERROR_CODES.EVENT_CONSUMER_DISABLED);
    throw new ConflictError("This Delivery is already on its way", ERROR_CODES.EVENT_DELIVERY_ALREADY_DUE);
  }
  await logActivity(db, c.get("user"), ACTIONS.EVENT_DELIVERY_RETRIED, { type: "event_delivery", id });
  return c.json({ success: true, data: { reopened: retry.reopened, created: retry.created } }, 202);
}
