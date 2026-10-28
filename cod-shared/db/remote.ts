/**
 * A store's database reached from outside its Worker — the Cloud, through
 * the D1 HTTP API — as the same drizzle database the Worker uses, so shared
 * modules run unchanged on either side.
 */
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

export interface RemoteQuery {
  sql: string;
  params: unknown[];
  method: "run" | "all" | "values" | "get";
}

/**
 * Runs queries in order, as one transaction when there are several; each
 * result's `rows` are arrays of values in the order the query selects them
 * (the D1 HTTP API's `raw` form).
 */
export type RemoteExecutor = (queries: readonly RemoteQuery[]) => Promise<Array<{ rows: unknown[][] }>>;

export function remoteDb(execute: RemoteExecutor) {
  // A `get` answers one row, or none: drizzle reads `undefined` as "no row".
  const shape = (method: RemoteQuery["method"], rows: unknown[][]) => ({ rows: method === "get" ? (rows[0] as unknown[]) : rows });
  return drizzle(
    async (sql, params, method) => shape(method, (await execute([{ sql, params, method }]))[0]!.rows),
    async (queries) => (await execute(queries)).map((result, i) => shape(queries[i]!.method, result.rows)),
    { schema },
  );
}

export type RemoteDb = ReturnType<typeof remoteDb>;
