import { describe, expect, it } from "vitest";
import { checksOf, dataChange, dataSafety, migrationProblems, statementsOf } from "./migration-safety";

describe("what a statement does to stored rows", () => {
  it.each([
    ["DELETE FROM orders WHERE id = 'x'", { kind: "DELETE", table: "orders" }],
    ['UPDATE "orders" SET status = \'new\'', { kind: "UPDATE", table: "orders" }],
    ["UPDATE OR IGNORE `products` SET price = 1", { kind: "UPDATE", table: "products" }],
    ["INSERT OR REPLACE INTO stores (id) VALUES ('s')", { kind: "REPLACE", table: "stores" }],
    ["REPLACE INTO stores (id) VALUES ('s')", { kind: "REPLACE", table: "stores" }],
    ["DROP TABLE IF EXISTS [offers]", { kind: "DROP TABLE", table: "offers" }],
    ["ALTER TABLE stores DROP COLUMN font_url", { kind: "DROP COLUMN", table: "stores", column: "font_url" }],
    ["ALTER TABLE offers_new RENAME TO offers", { kind: "RENAME TABLE", table: "offers_new", to: "offers" }],
    ["ALTER TABLE orders RENAME COLUMN notes TO note", { kind: "RENAME COLUMN", table: "orders", column: "notes" }],
  ])("%s", (statement, change) => {
    expect(dataChange(statement)).toEqual(change);
  });

  it.each([
    "CREATE TABLE x (id TEXT PRIMARY KEY)",
    "CREATE INDEX idx ON orders (status)",
    "ALTER TABLE orders ADD COLUMN note TEXT",
    "INSERT OR IGNORE INTO wilayas (id) VALUES (1)",
    "INSERT INTO offers_new SELECT * FROM offers",
    "DROP INDEX idx_old",
    "CREATE TRIGGER t AFTER DELETE ON products BEGIN DELETE FROM translations WHERE resource_id = OLD.id; END",
    "PRAGMA defer_foreign_keys = true",
  ])("%s adds, or runs later", (statement) => {
    expect(dataChange(statement)).toBeNull();
  });
});

describe("a migration's declarations", () => {
  it("name tables, columns and rebuilds, each with its reason", () => {
    const safety = dataSafety(`
-- data-safety: orders.status — 'pending' becomes 'new'
--data-safety: Rebuild Offers - every row copied
-- data-safety: capi_event_log — rows older than the rule are no longer kept
-- data-safety: orders
-- data-safety: rebuild offers.id — a rebuild is of a table
`);
    expect([...safety.columns]).toEqual(["orders.status"]);
    expect([...safety.rebuilt]).toEqual(["offers"]);
    expect([...safety.tables]).toEqual(["capi_event_log"]);
    expect(safety.malformed).toEqual(["-- data-safety: orders", "-- data-safety: rebuild offers.id — a rebuild is of a table"]);
  });
});

describe("a new migration as written", () => {
  const FILE = "0055_example.sql";

  it("passes when it only adds", () => {
    expect(migrationProblems(FILE, "CREATE TABLE a (id TEXT PRIMARY KEY);\nALTER TABLE orders ADD COLUMN note TEXT;\n", false)).toEqual([]);
  });

  it("names every change it makes to stored data", () => {
    expect(migrationProblems(FILE, "UPDATE orders SET status = 'new';\nDELETE FROM carts;\nALTER TABLE stores DROP COLUMN font_url;\n", true)).toEqual([
      `${FILE}: UPDATE on orders is not declared — add "-- data-safety: orders — <why no merchant data is lost>"`,
      `${FILE}: DELETE on carts is not declared — add "-- data-safety: carts — <why no merchant data is lost>"`,
      `${FILE}: DROP COLUMN on stores.font_url is not declared — add "-- data-safety: stores.font_url — <why no merchant data is lost>"`,
    ]);
  });

  it("asks a rebuild to say so", () => {
    const rebuild = "CREATE TABLE offers_new (id TEXT PRIMARY KEY);\nINSERT INTO offers_new SELECT id FROM offers;\nDROP TABLE offers;\nALTER TABLE offers_new RENAME TO offers;\n";
    expect(migrationProblems(FILE, rebuild, true)).toEqual([
      `${FILE}: DROP TABLE on offers is not declared — add "-- data-safety: rebuild offers — <why no merchant data is lost>"`,
      `${FILE}: RENAME TABLE on offers_new is not declared — add "-- data-safety: rebuild offers — <why no merchant data is lost>"`,
    ]);
    expect(migrationProblems(FILE, `-- data-safety: rebuild offers — every row and column copied\n${rebuild}`, true)).toEqual([]);
  });

  it("accepts each change by what it declares, and no more", () => {
    expect(migrationProblems(FILE, "-- data-safety: orders.status — renamed value\nUPDATE orders SET status = 'new';\n", true)).toEqual([]);
    expect(migrationProblems(FILE, "-- data-safety: orders.status — renamed value\nDELETE FROM orders;\n", true)).toHaveLength(1);
    expect(migrationProblems(FILE, "-- data-safety: stores.font_url — unused since 0046\nALTER TABLE stores DROP COLUMN logo_url;\n", true)).toHaveLength(1);
    expect(migrationProblems(FILE, "-- data-safety: stores — the dev store is replaced\nINSERT OR REPLACE INTO stores (id) VALUES ('s');\n", true)).toEqual([]);
    expect(migrationProblems(FILE, "-- data-safety: rebuild offers — copied\nDROP TABLE products;\n", true)).toHaveLength(1);
  });

  it("proves a change on data in its own test", () => {
    expect(migrationProblems(FILE, "-- data-safety: orders.status — renamed value\nUPDATE orders SET status = 'new';\n", false)).toEqual([
      `${FILE}: changes data, so it needs its own src/db/migration-0055-*.e2e.test.ts proving it on data`,
    ]);
  });

  it("refuses PRAGMA foreign_keys and a declaration it cannot read", () => {
    expect(migrationProblems(FILE, "PRAGMA foreign_keys = OFF;\n-- data-safety: orders\nCREATE TABLE a (id TEXT);\n", true)).toEqual([
      `${FILE}: "-- data-safety: orders" — write "-- data-safety: <table>[.<column>] — <reason>" or "-- data-safety: rebuild <table> — <reason>"`,
      `${FILE}: PRAGMA foreign_keys does nothing on D1, which always enforces foreign keys`,
    ]);
  });

  it("reads statements across drizzle's breakpoints, without comments", () => {
    expect(statementsOf("-- a note\nCREATE TABLE a (id TEXT);--> statement-breakpoint\nDELETE   FROM\n  b;\n")).toEqual(["CREATE TABLE a (id TEXT)", "DELETE FROM b"]);
  });
});

describe("a table's CHECK expressions", () => {
  it("are read whole, parentheses and quotes included", () => {
    expect(
      checksOf(`CREATE TABLE c (
  code text CHECK (length(code) BETWEEN 3 AND 32 AND code NOT GLOB '*[^A-Z0-9_-]*'),
  kind text NOT NULL CHECK (kind IN ('a', 'b)')),
  CHECK ((kind = 'a' AND value >= 1) OR (kind = 'b' AND value = 0))
)`),
    ).toEqual(["length(code) BETWEEN 3 AND 32 AND code NOT GLOB '*[^A-Z0-9_-]*'", "kind IN ('a', 'b)')", "(kind = 'a' AND value >= 1) OR (kind = 'b' AND value = 0)"]);
  });
});
