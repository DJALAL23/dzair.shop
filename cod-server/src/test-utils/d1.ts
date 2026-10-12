/**
 * A real D1 database for tests, built by replaying the actual migrations.
 *
 * The mock db in `mock-db.ts` maps a full-table `select()` positionally by
 * schema column order, which makes it useless for anything that reads across
 * two tables or depends on a real WHERE. Tests about precedence, joins, or
 * constraints must run against the real engine or they prove nothing.
 *
 * Each caller gets its own isolated database. Register the returned `dispose`
 * in `afterAll` — Miniflare holds a workerd process open until it is called.
 */
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";

const MIGRATIONS_DIR = resolve(__dirname, "../db/migrations");

/**
 * D1 caps how many statements one batch may carry, and the full migration set
 * is well past it — replay in chunks rather than one call.
 */
const BATCH_SIZE = 50;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function migrationStatements(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((chunk) => chunk.split(/;\s*\n/))
      .map((statement) => statement.replace(/;+\s*$/, "").trim())
      // A chunk that is only comments has no statement in it.
      .filter((statement) => statement.replace(/--[^\n]*/g, "").trim().length > 0),
  );
}

export interface TestD1 {
  db: AppDb;
  raw: D1Database;
  /**
   * Apply the migrations held back by `createTestD1({ before })`, so a test
   * can seed rows in the old shape and watch a migration convert them.
   */
  applyRemaining: () => Promise<void>;
  dispose: () => Promise<void>;
}

async function replay(raw: D1Database, files: readonly string[]): Promise<void> {
  const prepared = migrationStatements(files).map((statement) => raw.prepare(statement));
  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    await raw.batch(prepared.slice(i, i + BATCH_SIZE));
  }
}

/**
 * A database with every migration applied — or, with `before`, only the ones
 * that sort before that file name (e.g. `"0035_store_locales.sql"`).
 */
export async function createTestD1(options: { before?: string } = {}): Promise<TestD1> {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });

  const raw = await mf.getD1Database("DB");
  const files = migrationFiles();
  const cut = options.before === undefined ? files.length : files.findIndex((file) => file >= options.before!);
  if (cut === -1) throw new Error(`no migration sorts at or after ${options.before}`);
  await replay(raw, files.slice(0, cut));

  return {
    db: drizzle(raw as unknown as D1Database, { schema }) as unknown as AppDb,
    raw,
    applyRemaining: () => replay(raw, files.slice(cut)),
    dispose: () => mf.dispose(),
  };
}
