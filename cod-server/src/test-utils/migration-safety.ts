/**
 * A store's data survives every migration: what a new migration file is held
 * to before a release ships it (src/db/migration-safety.e2e.test.ts). A store's
 * database is the merchant's business — orders, customers, products — and a
 * migration runs on every live store, with no way back but a backup.
 *
 * Read: a statement that deletes or rewrites rows names its table in a
 * declaration, with the reason no merchant data is lost, and the file has its
 * own `migration-<NNNN>-*.e2e.test.ts` proving it on data:
 *
 *   -- data-safety: orders.status — 'pending' is renamed 'new', nothing else changes
 *   -- data-safety: rebuild offers — every row and column copied; nothing references offers
 *
 * `<table>` lets the table's rows change, `<table>.<column>` that column's
 * values (or its removal), `rebuild <table>` the drop-and-rename of a table
 * rebuilt whole. `PRAGMA foreign_keys` is refused: D1 always enforces them.
 *
 * Run: the migration is applied to a database where every table holds a row;
 * after it, every row of every table is still there with every value it kept,
 * but for what the file declares. This catches what reading misses — on D1,
 * dropping a table that others reference deletes their rows through ON DELETE
 * CASCADE, `PRAGMA defer_foreign_keys` or not — and a migration that only
 * fails on a store that has data.
 */
import { splitMigration } from "./d1";

export interface DataSafety {
  /** Tables whose rows may change. */
  tables: Set<string>;
  /** `table.column` whose values may change. */
  columns: Set<string>;
  /** Tables rebuilt whole: dropped and renamed into place, every row and value kept. */
  rebuilt: Set<string>;
  /** Declarations without a reason, or that name nothing. */
  malformed: string[];
}

const IDENT = String.raw`["\`\[]?(\w+)["\`\]]?`;

export function dataSafety(sql: string): DataSafety {
  const safety: DataSafety = { tables: new Set(), columns: new Set(), rebuilt: new Set(), malformed: [] };
  for (const [line, body] of sql.matchAll(/^\s*--\s*data-safety:\s*(.*)$/gim)) {
    const match = /^(rebuild\s+)?(\w+)(?:\.(\w+))?\s+(?:—|-)\s+(\S.*)$/i.exec(body!.trim());
    if (!match) {
      safety.malformed.push(line!.trim());
      continue;
    }
    const [, rebuild, table, column] = match;
    if (rebuild && column) safety.malformed.push(line!.trim());
    else if (rebuild) safety.rebuilt.add(table!.toLowerCase());
    else if (column) safety.columns.add(`${table!.toLowerCase()}.${column.toLowerCase()}`);
    else safety.tables.add(table!.toLowerCase());
  }
  return safety;
}

export type ChangeKind = "DELETE" | "UPDATE" | "REPLACE" | "DROP TABLE" | "DROP COLUMN" | "RENAME TABLE" | "RENAME COLUMN";

export interface DataChange {
  kind: ChangeKind;
  table: string;
  /** The column, for DROP COLUMN and RENAME COLUMN. */
  column?: string;
  /** For RENAME TABLE: the name it takes. */
  to?: string;
}

/** A migration file's statements as the deployments split them, comments removed and spacing made single, to be read. */
export function statementsOf(sql: string): string[] {
  return splitMigration(sql).map((statement) => statement.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim());
}

/** What a statement does to existing rows when it runs; null for a statement that only adds. A trigger's body runs later, not here. */
export function dataChange(statement: string): DataChange | null {
  if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(statement)) return null;
  const lower = (value: string) => value.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^DELETE\\s+FROM\\s+${IDENT}`, "i").exec(statement))) return { kind: "DELETE", table: lower(m[1]!) };
  if ((m = new RegExp(`^UPDATE\\s+(?:OR\\s+\\w+\\s+)?${IDENT}\\s+SET\\b`, "i").exec(statement))) return { kind: "UPDATE", table: lower(m[1]!) };
  if ((m = new RegExp(`^(?:INSERT\\s+OR\\s+REPLACE|REPLACE)\\s+INTO\\s+${IDENT}`, "i").exec(statement))) return { kind: "REPLACE", table: lower(m[1]!) };
  if ((m = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, "i").exec(statement))) return { kind: "DROP TABLE", table: lower(m[1]!) };
  if ((m = new RegExp(`^ALTER\\s+TABLE\\s+${IDENT}\\s+DROP\\s+(?:COLUMN\\s+)?${IDENT}`, "i").exec(statement))) return { kind: "DROP COLUMN", table: lower(m[1]!), column: lower(m[2]!) };
  if ((m = new RegExp(`^ALTER\\s+TABLE\\s+${IDENT}\\s+RENAME\\s+TO\\s+${IDENT}`, "i").exec(statement))) return { kind: "RENAME TABLE", table: lower(m[1]!), to: lower(m[2]!) };
  if ((m = new RegExp(`^ALTER\\s+TABLE\\s+${IDENT}\\s+RENAME\\s+(?:COLUMN\\s+)?${IDENT}\\s+TO\\b`, "i").exec(statement))) return { kind: "RENAME COLUMN", table: lower(m[1]!), column: lower(m[2]!) };
  return null;
}

function declared(change: DataChange, safety: DataSafety): boolean {
  const { kind, table, column, to } = change;
  if (safety.tables.has(table)) return true;
  switch (kind) {
    case "UPDATE":
      return [...safety.columns].some((entry) => entry.startsWith(`${table}.`));
    case "DROP COLUMN":
    case "RENAME COLUMN":
      return safety.columns.has(`${table}.${column}`);
    case "DROP TABLE":
      return safety.rebuilt.has(table);
    case "RENAME TABLE":
      return to !== undefined && (safety.rebuilt.has(to) || safety.tables.has(to));
    default:
      return false;
  }
}

/** What is wrong with a new migration file as written, or nothing. `hasOwnTest`: its `migration-<NNNN>-*.e2e.test.ts` exists. */
export function migrationProblems(file: string, sql: string, hasOwnTest: boolean): string[] {
  const problems: string[] = [];
  const safety = dataSafety(sql);
  for (const line of safety.malformed) problems.push(`${file}: "${line}" — write "-- data-safety: <table>[.<column>] — <reason>" or "-- data-safety: rebuild <table> — <reason>"`);
  for (const statement of statementsOf(sql)) {
    if (/^PRAGMA\s+foreign_keys\b/i.test(statement)) {
      problems.push(`${file}: PRAGMA foreign_keys does nothing on D1, which always enforces foreign keys`);
      continue;
    }
    const change = dataChange(statement);
    if (change && !declared(change, safety)) {
      const target = change.column ? `${change.table}.${change.column}` : change.table;
      problems.push(`${file}: ${change.kind} on ${target} is not declared — add "-- data-safety: ${change.kind === "DROP TABLE" || change.kind === "RENAME TABLE" ? `rebuild ${change.to ?? change.table}` : target} — <why no merchant data is lost>"`);
    }
  }
  const declares = safety.tables.size + safety.columns.size + safety.rebuilt.size > 0;
  if (declares && !hasOwnTest) problems.push(`${file}: changes data, so it needs its own src/db/migration-${file.slice(0, 4)}-*.e2e.test.ts proving it on data`);
  return problems;
}

// ─── On data ─────────────────────────────────────────────────────────────────

/** Bookkeeping, not store data. */
const INTERNAL = /^(sqlite_|_cf_|d1_migrations$|_codflow_migrations$)/;

interface Column {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  hidden: number;
}

async function storeTables(db: D1Database): Promise<Array<{ name: string; sql: string }>> {
  const rows = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all<{ name: string; sql: string }>()).results;
  return rows.filter((row) => !INTERNAL.test(row.name));
}

const columnsOf = async (db: D1Database, table: string) =>
  (await db.prepare(`SELECT name, type, "notnull", pk, hidden FROM pragma_table_xinfo('${table}')`).all<Column>()).results.filter((column) => column.hidden === 0);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The values a column could hold, likeliest first: its CHECK's literals, then by type, NULL last when it may be. */
function candidates(table: { name: string; sql: string }, column: Column): Array<string | number | null> {
  const literals: string[] = [];
  const name = String.raw`["\`]?\b${column.name}\b["\`]?`;
  for (const [, list] of table.sql.matchAll(new RegExp(String.raw`${name}\s+IN\s*\(([^)]*)\)`, "gi"))) {
    for (const [, literal] of list!.matchAll(/'((?:[^']|'')*)'/g)) literals.push(literal!.replace(/''/g, "'"));
  }
  for (const [, literal] of table.sql.matchAll(new RegExp(String.raw`${name}\s*=\s*'((?:[^']|'')*)'`, "gi"))) literals.push(literal!.replace(/''/g, "'"));
  const type = column.type.toUpperCase();
  const byType: Array<string | number> = /INT|BOOL/.test(type)
    ? [1, 0, 2, 100]
    : /REAL|FLOA|DOUB|NUM|DEC/.test(type)
      ? [1.5, 1, 0]
      : [`${table.name}.${column.name}`, "{}", "[]", "2026-01-01T00:00:00.000Z", "CODE1", "slug", "1", 1, 0];
  return [...literals, ...byType, ...(column.notnull ? [] : [null])];
}

/** The CHECK expressions of a CREATE TABLE statement, column and table ones alike. */
export function checksOf(sql: string): string[] {
  const checks: string[] = [];
  for (const match of sql.matchAll(/\bCHECK\s*\(/gi)) {
    let depth = 0;
    let quoted = false;
    const start = match.index! + match[0].length;
    for (let i = start - 1; i < sql.length; i++) {
      const char = sql[i];
      if (char === "'") quoted = !quoted;
      else if (!quoted && char === "(") depth++;
      else if (!quoted && char === ")" && --depth === 0) {
        checks.push(sql.slice(start, i));
        break;
      }
    }
  }
  return checks;
}

/**
 * Give every empty table a row, parents before children, every column given a
 * value its constraints accept. Returns the tables no row could be made for.
 */
export async function fillEveryTable(db: D1Database): Promise<Array<{ table: string; error: string }>> {
  const tables = await storeTables(db);
  const parents = new Map<string, Array<{ table: string; from: string; to: string | null }>>();
  for (const table of tables) {
    parents.set(table.name, (await db.prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list('${table.name}')`).all<{ table: string; from: string; to: string | null }>()).results);
  }
  const failed: Array<{ table: string; error: string }> = [];
  const done = new Set<string>();
  const fill = async (table: { name: string; sql: string }, trail: string[]): Promise<boolean> => {
    if (done.has(table.name)) return !failed.some((f) => f.table === table.name);
    done.add(table.name);
    const fks = parents.get(table.name)!;
    const columns = (await columnsOf(db, table.name)).filter((column) => !(column.pk === 1 && /^INTEGER$/i.test(column.type)));
    const required = (from: string) => columns.find((column) => column.name === from)?.notnull === 1;
    for (const fk of fks) {
      if (fk.table === table.name || trail.includes(fk.table)) continue;
      const parent = tables.find((t) => t.name === fk.table);
      if ((!parent || !(await fill(parent, [...trail, table.name]))) && required(fk.from)) {
        failed.push({ table: table.name, error: `its parent ${fk.table} has no row` });
        return false;
      }
    }
    if ((await db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table.name)}`).first<{ n: number }>())!.n > 0) return true;

    const options = new Map<string, Array<string | number | null>>();
    for (const column of columns) {
      const fk = fks.find((f) => f.from === column.name);
      if (fk) {
        const to = fk.to ?? (await columnsOf(db, fk.table)).find((c) => c.pk > 0)?.name ?? "rowid";
        const parentValue = fk.table === table.name ? null : ((await db.prepare(`SELECT ${quote(to)} AS v FROM ${quote(fk.table)} LIMIT 1`).first<{ v: string | number }>())?.v ?? null);
        options.set(column.name, parentValue === null ? [null] : [parentValue, ...(column.notnull ? [] : [null])]);
      } else {
        options.set(column.name, candidates(table, column));
      }
    }
    const names = columns.map((column) => column.name);
    const values = (choice: ReadonlyMap<string, number>) => names.map((name) => options.get(name)![choice.get(name)!]!);
    const checks = checksOf(table.sql);
    const row = names.map((name, i) => `?${i + 1} AS ${quote(name)}`).join(", ") || "NULL AS _";
    const fails = async (choice: ReadonlyMap<string, number>, picked: readonly number[]) =>
      db
        .prepare(`SELECT ${picked.map((i) => `NOT COALESCE((${checks[i]}), 1) AS f${i}`).join(", ")} FROM (SELECT ${row})`)
        .bind(...values(choice))
        .first<Record<string, number>>();
    const failing = async (choice: ReadonlyMap<string, number>): Promise<number[]> => {
      const all = checks.map((_, i) => i);
      if (all.length === 0) return [];
      try {
        const result = await fails(choice, all);
        return all.filter((i) => result![`f${i}`] === 1);
      } catch {
        const broken: number[] = [];
        for (const i of all) {
          try {
            if ((await fails(choice, [i]))![`f${i}`] === 1) broken.push(i);
          } catch {
            broken.push(i);
          }
        }
        return broken;
      }
    };
    let choice = new Map(names.map((name) => [name, 0]));
    let broken = await failing(choice);
    for (let round = 0; broken.length > 0 && round < 100; round++) {
      const involved = names.filter((name) => broken.some((i) => new RegExp(`\\b${name}\\b`).test(checks[i]!)));
      const moves: Array<Map<string, number>> = [];
      for (const a of involved) for (let i = 0; i < options.get(a)!.length; i++) moves.push(new Map(choice).set(a, i));
      for (const a of involved) {
        for (const b of involved) {
          if (a >= b) continue;
          for (let i = 0; i < options.get(a)!.length; i++) for (let j = 0; j < options.get(b)!.length; j++) moves.push(new Map(choice).set(a, i).set(b, j));
        }
      }
      let better: { choice: Map<string, number>; broken: number[] } | null = null;
      for (const move of moves) {
        const result = await failing(move);
        if (result.length < broken.length) {
          better = { choice: move, broken: result };
          break;
        }
      }
      if (!better) break;
      ({ choice, broken } = better);
    }
    let error = broken.length > 0 ? `no value satisfies CHECK (${checks[broken[0]!]})` : "";
    if (!error) {
      try {
        await db.prepare(`INSERT INTO ${quote(table.name)} (${names.map(quote).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).bind(...values(choice)).run();
        return true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    failed.push({ table: table.name, error });
    return false;
  };
  for (const table of tables) await fill(table, []);
  return failed;
}

export interface Snapshot {
  tables: Map<string, { columns: string[]; rows: Array<Record<string, unknown>> }>;
}

export async function snapshot(db: D1Database): Promise<Snapshot> {
  const tables: Snapshot["tables"] = new Map();
  for (const table of await storeTables(db)) {
    const columns = (await columnsOf(db, table.name)).map((column) => column.name);
    const rows = (await db.prepare(`SELECT * FROM ${quote(table.name)}`).all<Record<string, unknown>>()).results;
    tables.set(table.name.toLowerCase(), { columns: columns.map((c) => c.toLowerCase()), rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]))) });
  }
  return { tables };
}

/** What a migration lost: tables, columns, rows or values that were there before it and are not after, but for what it declares. */
export function dataLost(before: Snapshot, after: Snapshot, safety: DataSafety): string[] {
  const lost: string[] = [];
  for (const [name, table] of before.tables) {
    if (safety.tables.has(name) || table.rows.length === 0) continue;
    const now = after.tables.get(name);
    if (!now) {
      lost.push(`table ${name} is gone with its ${table.rows.length} row(s)`);
      continue;
    }
    for (const column of table.columns) {
      if (!now.columns.includes(column) && !safety.columns.has(`${name}.${column}`)) lost.push(`column ${name}.${column} is gone with its values`);
    }
    const kept = table.columns.filter((column) => now.columns.includes(column) && !safety.columns.has(`${name}.${column}`));
    const key = (row: Record<string, unknown>) => JSON.stringify(kept.map((column) => row[column] ?? null));
    const remaining = new Map<string, number>();
    for (const row of now.rows) remaining.set(key(row), (remaining.get(key(row)) ?? 0) + 1);
    for (const row of table.rows) {
      const count = remaining.get(key(row)) ?? 0;
      if (count > 0) remaining.set(key(row), count - 1);
      else lost.push(`a row of ${name} is gone or changed: ${key(row)}`);
    }
  }
  return lost;
}

/**
 * Apply `migrations` in order to a database, giving every table a row before
 * each — tables a migration creates included — and report what each lost or
 * why it failed. A failure stops the run: later migrations need it.
 */
export async function lossesOnData(
  db: D1Database,
  migrations: ReadonlyArray<{ file: string; sql: string }>,
  apply: (migration: { file: string; sql: string }) => Promise<void>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const migration of migrations) {
    for (const { table, error } of await fillEveryTable(db)) problems.push(`${migration.file}: no row could be made for ${table} to check it (${error})`);
    const before = await snapshot(db);
    try {
      await apply(migration);
    } catch (error) {
      problems.push(`${migration.file} fails on a store with data: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    for (const lost of dataLost(before, await snapshot(db), dataSafety(migration.sql))) problems.push(`${migration.file}: ${lost}`);
  }
  return problems;
}
