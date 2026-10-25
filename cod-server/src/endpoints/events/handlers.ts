import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { NotFoundError } from "@/lib/errors/classes";
import { readBusinessEvent, readEventLog } from "../../../../cod-shared/events/log";
import type { eventLogQuerySchema } from "./validation";

export async function listEvents(c: Context<AppContext>) {
  const { type, ...query } = (c.req as any).valid("query") as z.output<typeof eventLogQuerySchema>;
  const page = await readEventLog(getDb(c.env.DB), { ...query, types: type });
  return c.json({ success: true, data: page.events, count: page.events.length, nextCursor: page.next }, 200);
}

export async function getEvent(c: Context<AppContext>) {
  const { id } = (c.req as any).valid("param") as { id: string };
  const event = await readBusinessEvent(getDb(c.env.DB), id);
  if (!event) throw new NotFoundError("Business Event", id);
  return c.json({ success: true, data: event }, 200);
}
