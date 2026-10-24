/**
 * Every store's data survives the migrations a release brings
 * (test-utils/migration-safety.ts). The migrations through RELEASED_THROUGH
 * shipped before this guard and were reviewed by hand; every later one is held
 * to it — as written, and on a database where every table holds a row. The
 * platform release runs this file even when it skips the other checks.
 *
 * The second half proves the guard on a real D1: what it must catch, written
 * as migrations, caught.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestD1, migrationFiles, replay, splitMigration, type TestD1 } from "@/test-utils/d1";
import { fillEveryTable, lossesOnData, migrationProblems, snapshot } from "@/test-utils/migration-safety";

/**
 * Each case replays every migration on a database with a row in every table:
 * 10–14 s alone, more beside the rest of the suite, and longer with each
 * migration added. The limit is the work's, not the default's.
 */
const GUARD_TIMEOUT = 120_000;

const RELEASED_THROUGH = "0054_theme_drafts.sql";

const newMigrations = migrationFiles().filter((file) => file > RELEASED_THROUGH);
const hasOwnTest = (file: string) => readdirSync(__dirname).some((name) => name.startsWith(`migration-${file.slice(0, 4)}-`) && name.endsWith(".e2e.test.ts"));

describe(`migrations after ${RELEASED_THROUGH}`, { timeout: GUARD_TIMEOUT }, () => {
  it("baseline is a migration that exists", () => {
    expect(existsSync(`${MIGRATIONS_DIR}/${RELEASED_THROUGH}`)).toBe(true);
  });

  it.each(newMigrations.map((file) => [file]))("%s declares every change to stored data", (file) => {
    expect(migrationProblems(file, readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"), hasOwnTest(file))).toEqual([]);
  });

  it.runIf(newMigrations.length > 0)(
    "keep every row and value of a store with data in every table",
    async () => {
      const d1 = await createTestD1({ before: newMigrations[0] });
      try {
        const migrations = newMigrations.map((file) => ({ file, sql: readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8") }));
        expect(await lossesOnData(d1.raw, migrations, ({ file }) => replay(d1.raw, [file]))).toEqual([]);
      } finally {
        await d1.dispose();
      }
    },
    600_000,
  );
});

describe("the guard, on a store with data in every table", { timeout: GUARD_TIMEOUT }, () => {
  let d1: TestD1;

  beforeAll(async () => {
    d1 = await createTestD1();
    expect(await fillEveryTable(d1.raw)).toEqual([]);
  }, 300_000);
  afterAll(async () => d1?.dispose());

  const apply = ({ sql }: { sql: string }) => d1.raw.batch(splitMigration(sql).map((statement) => d1.raw.prepare(statement))).then(() => undefined);
  /** Run `sql` as the next migration: what it lost, or why it failed. */
  const migrate = (sql: string) => lossesOnData(d1.raw, [{ file: "0099_test.sql", sql }], apply);

  it("can give every table of today's schema a row", async () => {
    const tables = await snapshot(d1.raw);
    expect([...tables.tables].filter(([, table]) => table.rows.length === 0).map(([name]) => name)).toEqual([]);
  });

  it("passes a migration that only adds", async () => {
    expect(
      await migrate(`CREATE TABLE gift_wraps (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL);
ALTER TABLE orders ADD COLUMN gift_note TEXT;
CREATE INDEX idx_orders_gift_note ON orders (gift_note);
`),
    ).toEqual([]);
  });

  it("passes a declared change and catches the same change undeclared", async () => {
    expect(await migrate("UPDATE orders SET notes = 'changed';\n")).toEqual([expect.stringMatching(/^0099_test\.sql: a row of orders is gone or changed/)]);
    expect(await migrate("-- data-safety: orders.notes — every note is rewritten\nUPDATE orders SET notes = 'rewritten';\n")).toEqual([]);
    expect(await migrate("DROP INDEX idx_orders_gift_note;\nALTER TABLE orders DROP COLUMN gift_note;\n")).toEqual(["0099_test.sql: column orders.gift_note is gone with its values"]);
  });

  it("gives each migration's new tables a row before the next, and stops at one that fails", async () => {
    const problems = await lossesOnData(
      d1.raw,
      [
        { file: "0100_add.sql", sql: "CREATE TABLE gift_messages (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);\n" },
        { file: "0101_clear.sql", sql: "DELETE FROM gift_messages;\n" },
        { file: "0102_broken.sql", sql: "INSERT INTO nowhere VALUES (1);\n" },
        { file: "0103_never.sql", sql: "DELETE FROM orders;\n" },
      ],
      apply,
    );
    expect(problems).toEqual([
      expect.stringMatching(/^0101_clear\.sql: a row of gift_messages is gone or changed/),
      expect.stringMatching(/^0102_broken\.sql fails on a store with data: .*no such table: nowhere/),
    ]);
  });

  it("catches a rebuild that puts values in the wrong columns", async () => {
    const lost = await migrate(`-- data-safety: rebuild store_legal_profile — copied whole
CREATE TABLE store_legal_profile_new AS SELECT * FROM store_legal_profile;
UPDATE store_legal_profile_new SET legal_name = rc_number, rc_number = legal_name;
DROP TABLE store_legal_profile;
ALTER TABLE store_legal_profile_new RENAME TO store_legal_profile;
`);
    expect(lost).toEqual([expect.stringMatching(/^0099_test\.sql: a row of store_legal_profile is gone or changed/)]);
  });

  it("catches a migration that fails only on a store with data", async () => {
    const lost = await migrate(`CREATE TABLE coupons_strict (code TEXT NOT NULL CHECK (length(code) > 40));
INSERT INTO coupons_strict SELECT code FROM coupons;
`);
    expect(lost).toEqual([expect.stringMatching(/^0099_test\.sql fails on a store with data: .*CHECK constraint failed/)]);
    expect(await d1.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'coupons_strict'").first()).toBeNull();
  });

  it("catches the rows D1 deletes through ON DELETE CASCADE when a referenced table is rebuilt", async () => {
    const collections = (await d1.raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'collections'").first<{ sql: string }>())!.sql;
    const lost = await migrate(`-- data-safety: rebuild collections — every row and column copied
PRAGMA defer_foreign_keys = true;
${collections.replace(/^CREATE TABLE [\`"]?collections[\`"]?/, "CREATE TABLE collections_new").replace(/\s*\n\s*/g, " ")};
INSERT INTO collections_new SELECT * FROM collections;
DROP TABLE collections;
ALTER TABLE collections_new RENAME TO collections;
`);
    expect(lost.map((line) => /^0099_test\.sql: a row of (\w+)/.exec(line)?.[1]).sort(), lost.join("\n")).toEqual(["collection_products", "coupon_collections"]);
  });
});
