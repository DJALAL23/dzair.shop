import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";

/**
 * The same real database, but every statement whose SQL `failWhen` picks is
 * rejected — and a batch carrying one is rejected whole, as D1 rolls a batch
 * back. Proves a write is atomic with real SQL rather than mocks.
 */
export function makeFaultyDb(raw: D1Database, failWhen: (sqlText: string) => boolean): AppDb {
  const poisoned = () => {
    const stub: Record<string, unknown> = {
      __sql: "POISONED",
      bind: () => stub,
      run: () => Promise.reject(new Error("INJECTED FAULT")),
      raw: () => Promise.reject(new Error("INJECTED FAULT")),
      all: () => Promise.reject(new Error("INJECTED FAULT")),
      get: () => Promise.reject(new Error("INJECTED FAULT")),
      first: () => Promise.reject(new Error("INJECTED FAULT")),
    };
    return stub as unknown as D1PreparedStatement;
  };

  const faulty = {
    prepare: (sqlText: string) => {
      const stmt = raw.prepare(sqlText);
      if (failWhen(sqlText)) return poisoned();
      (stmt as D1PreparedStatement & { __sql?: string }).__sql = sqlText;
      return stmt;
    },
    batch: (stmts: D1PreparedStatement[]) => {
      for (const stmt of stmts) {
        const sqlText = (stmt as D1PreparedStatement & { __sql?: string }).__sql;
        if (sqlText === "POISONED" || (sqlText && failWhen(sqlText))) {
          return Promise.reject(new Error("INJECTED FAULT"));
        }
      }
      return raw.batch(stmts);
    },
    exec: (sqlText: string) => raw.exec(sqlText),
    dump: () => raw.dump(),
  } as unknown as D1Database;

  return drizzle(faulty, { schema }) as unknown as AppDb;
}
