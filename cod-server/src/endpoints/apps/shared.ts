import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { NotFoundError } from "@/lib/errors/classes";
import { getStore } from "../../../../cod-shared/queries/stores";

export const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

/** The route's validated body: the route's own schema has already run. */
export const bodyOf = <T extends z.ZodType>(c: Context<AppContext>) => (c.req as any).valid("json") as z.output<T>;

/** The store's database and its one store (single-tenant). */
export async function storeOf(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await getStore(db);
  if (!store) throw new NotFoundError("Store");
  return { db, store };
}
