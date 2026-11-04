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
import { TEST_MEDIA_VARS } from "./media";

export const MIGRATIONS_DIR = resolve(__dirname, "../db/migrations");

/**
 * D1 caps how many statements one batch may carry, and the full migration set
 * is well past it — replay in chunks rather than one call.
 */
const BATCH_SIZE = 50;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** A migration file's statements, split as the deployments split it. */
export function splitMigration(sql: string): string[] {
  return (
    sql
      .split("--> statement-breakpoint")
      .flatMap((chunk) => chunk.split(/;\s*\n/))
      .map((statement) => statement.replace(/;+\s*$/, "").trim())
      // A chunk that is only comments has no statement in it.
      .filter((statement) => statement.replace(/--[^\n]*/g, "").trim().length > 0)
  );
}

export function migrationStatements(files: readonly string[]): string[] {
  return files.flatMap((file) => splitMigration(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8")));
}

export interface TestD1 {
  db: AppDb;
  raw: D1Database;
  /** The worker's `MEDIA_BUCKET`: its staging, and its media (`MEDIA_HOST` is `r2`). */
  bucket: R2Bucket;
  /**
   * A request to the worker given as `worker` (see `bundleWorker`), served by
   * the real workerd runtime over this same database. Without a worker, a
   * placeholder answers "ok". Its media is the store server's in local
   * development (`TEST_MEDIA_VARS`).
   */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Apply the migrations held back by `createTestD1({ before })`, so a test
   * can seed rows in the old shape and watch a migration convert them —
   * all of them, or with `until`, only those sorting before that file.
   */
  applyRemaining: (options?: { until?: string }) => Promise<void>;
  dispose: () => Promise<void>;
}

/** Apply migration files in order, as the deployments do: each statement, in batches. */
export async function replay(raw: D1Database, files: readonly string[]): Promise<void> {
  const prepared = migrationStatements(files).map((statement) => raw.prepare(statement));
  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    await raw.batch(prepared.slice(i, i + BATCH_SIZE));
  }
}

/**
 * Bundle a worker module for `createTestD1({ worker })`. Code that needs the
 * Workers runtime itself — `HTMLRewriter`, which the rich-text sanitiser uses —
 * cannot run in the Node test pool, so a test that must cover it runs its
 * routes inside workerd instead. `source` is TypeScript resolved from
 * `resolveDir`, with the `@/` alias of `src/`.
 */
export async function bundleWorker(source: string, resolveDir: string, options: { external?: string[] } = {}): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: source, resolveDir, sourcefile: "worker.ts", loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "import"],
    external: ["node:*", "cloudflare:*", ...(options.external ?? [])],
    alias: { "@": resolve(__dirname, "..") },
    write: false,
    logLevel: "warning",
  });
  return result.outputFiles[0]!.text;
}

/**
 * A database with every migration applied — or, with `before`, only the ones
 * that sort before that file name (e.g. `"0035_store_locales.sql"`). With
 * `worker` (a `bundleWorker` result), requests through `fetch` run that worker
 * over the database.
 */
export async function createTestD1(options: { before?: string; worker?: string } = {}): Promise<TestD1> {
  try {
    return await startTestD1(options);
  } catch (error) {
    // Under a full parallel run, workerd can drop the connection while a fresh
    // database is being built; building it again gives the same database.
    if (!isTransportFailure(error)) throw error;
    return startTestD1(options);
  }
}

function isTransportFailure(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as Error)?.message === "fetch failed" && (cause?.code === "ECONNRESET" || cause?.code === "ECONNREFUSED" || cause?.code === "UND_ERR_SOCKET");
}

async function startTestD1(options: { before?: string; worker?: string }): Promise<TestD1> {
  const mf = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "index.mjs",
        contents: options.worker ?? "export default { fetch() { return new Response('ok'); } }",
      },
    ],
    // The deployed worker's runtime settings (wrangler.toml.example).
    compatibilityDate: "2024-11-27",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "test-db" },
    r2Buckets: ["MEDIA_BUCKET"],
    bindings: { ...TEST_MEDIA_VARS },
  });

  const files = migrationFiles();
  const cut = options.before === undefined ? files.length : files.findIndex((file) => file >= options.before!);
  if (cut === -1) throw new Error(`no migration sorts at or after ${options.before}`);
  let raw: D1Database;
  let bucket: R2Bucket;
  try {
    raw = await mf.getD1Database("DB");
    bucket = (await mf.getR2Bucket("MEDIA_BUCKET")) as unknown as R2Bucket;
    await replay(raw, files.slice(0, cut));
  } catch (error) {
    await mf.dispose().catch(() => {});
    throw error;
  }

  return {
    db: drizzle(raw as unknown as D1Database, { schema }) as unknown as AppDb,
    raw,
    bucket,
    fetch: async (url, init) => (await mf.getWorker()).fetch(url, init as never) as unknown as Response,
    applyRemaining: ({ until }: { until?: string } = {}) => {
      const end = until === undefined ? files.length : files.findIndex((file) => file >= until);
      if (end === -1) throw new Error(`no migration sorts at or after ${until}`);
      return replay(raw, files.slice(cut, end));
    },
    dispose: () => mf.dispose(),
  };
}
