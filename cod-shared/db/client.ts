import { drizzle } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type AppDb = ReturnType<typeof getDb>;

/** A store's database however it is reached: the Worker's binding (`getDb`) or D1 over HTTP (`remoteDb`). */
export type StoreDb = BaseSQLiteDatabase<"async", unknown, typeof schema>;
