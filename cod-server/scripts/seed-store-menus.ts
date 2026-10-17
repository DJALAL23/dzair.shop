#!/usr/bin/env -S npx tsx
/**
 * Gives a store its default menus, `main-menu` and `footer`
 * (cod-shared/navigation/default-menus.ts) — a thin wrapper that runs the
 * statements `defaultMenusSql` builds, through `wrangler d1 execute` like
 * scripts/seed-store-pages.ts. Idempotent: a store that has a menu with the
 * handle keeps it as it is.
 *
 * Usage:
 *   npx tsx scripts/seed-store-menus.ts                        # local D1, store-local-dev
 *   npx tsx scripts/seed-store-menus.ts --remote               # remote D1, store-local-dev
 *   npx tsx scripts/seed-store-menus.ts --store-id=store-abc123 --remote
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCloudEnv } from "./cloud-env.mjs";
import { defaultMenusSql } from "../../cod-shared/navigation/default-menus";
import { isStoreLocale, type StoreLocale } from "../../cod-shared/i18n/locales";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const storeIdArg = args.find((a) => a.startsWith("--store-id="));
const storeId = storeIdArg ? storeIdArg.slice("--store-id=".length) : "store-local-dev";

const { dbName } = getCloudEnv();
const target = remote ? "--remote -y" : "--local --persist-to ../.wrangler-shared";
const cwd = join(__dirname, "..");

function query<T>(sql: string): T[] {
  const out = execSync(`npx wrangler d1 execute ${dbName} ${target} --json --command "${sql.replace(/"/g, '\\"')}"`, { cwd, stdio: "pipe" }).toString();
  return (JSON.parse(out) as Array<{ results?: T[] }>)[0]?.results ?? [];
}

const id = storeId.replace(/'/g, "''");
const store = query<{ id: string; lang: string }>(`SELECT id, lang FROM stores WHERE id = '${id}'`)[0];
if (!store || !isStoreLocale(store.lang)) {
  console.error(`[seed-store-menus] No store found with id "${storeId}" — create the store row first.`);
  process.exit(1);
}
const locales = query<{ locale: string }>(`SELECT locale FROM store_locales WHERE store_id = '${id}'`)
  .map((row) => row.locale)
  .filter(isStoreLocale) as StoreLocale[];

async function main() {
  const statements = await defaultMenusSql({ id: store.id, lang: store.lang, locales }, new Date().toISOString());
  const dir = mkdtempSync(join(tmpdir(), "seed-menus-"));
  const file = join(dir, "menus.sql");
  writeFileSync(file, statements.map((statement) => `${statement};`).join("\n"));
  try {
    execSync(`npx wrangler d1 execute ${dbName} ${target} --file "${file}"`, { cwd, stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const menus = query<{ handle: string; items: number }>(
    `SELECT m.handle, (SELECT count(*) FROM store_menu_items i WHERE i.menu_id = m.id) AS items FROM store_menus m WHERE m.store_id = '${id}' ORDER BY m.created_at`,
  );
  console.log(`[seed-store-menus] ${storeId}: ${menus.map((menu) => `${menu.handle} (${menu.items} items)`).join(", ")}`);
}

void main();
