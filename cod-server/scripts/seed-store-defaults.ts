#!/usr/bin/env -S npx tsx
/**
 * Gives a store what every store starts with: the menus `main-menu` and
 * `footer` (cod-shared/navigation/default-menus.ts) and the collections
 * `featured`, `best-sellers` and `new-arrivals`
 * (cod-shared/catalog/collections.ts) — a thin wrapper that runs the
 * statements those modules build, through `wrangler d1 execute` like
 * scripts/seed-store-pages.ts. Idempotent: a menu or collection the store
 * already has under the handle is kept as it is.
 *
 * Usage:
 *   npx tsx scripts/seed-store-defaults.ts                        # local D1, store-local-dev
 *   npx tsx scripts/seed-store-defaults.ts --remote               # remote D1, store-local-dev
 *   npx tsx scripts/seed-store-defaults.ts --store-id=store-abc123 --remote
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCloudEnv } from "./cloud-env.mjs";
import { defaultMenusSql } from "../../cod-shared/navigation/default-menus";
import { defaultCollectionsSql } from "../../cod-shared/catalog/collections";
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
  console.error(`[seed-store-defaults] No store found with id "${storeId}" — create the store row first.`);
  process.exit(1);
}
const locales = query<{ locale: string }>(`SELECT locale FROM store_locales WHERE store_id = '${id}'`)
  .map((row) => row.locale)
  .filter(isStoreLocale) as StoreLocale[];

async function main() {
  const now = new Date().toISOString();
  const defaults = { id: store.id, lang: store.lang, locales };
  const statements = [...(await defaultMenusSql(defaults, now)), ...(await defaultCollectionsSql(defaults, now))];
  const dir = mkdtempSync(join(tmpdir(), "seed-defaults-"));
  const file = join(dir, "defaults.sql");
  writeFileSync(file, statements.map((statement) => `${statement};`).join("\n"));
  try {
    execSync(`npx wrangler d1 execute ${dbName} ${target} --file "${file}"`, { cwd, stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const menus = query<{ handle: string; items: number }>(
    `SELECT m.handle, (SELECT count(*) FROM store_menu_items i WHERE i.menu_id = m.id) AS items FROM store_menus m WHERE m.store_id = '${id}' ORDER BY m.created_at`,
  );
  const collections = query<{ handle: string; products: number }>(
    `SELECT c.handle, (SELECT count(*) FROM collection_products p WHERE p.collection_id = c.id) AS products FROM collections c WHERE c.store_id = '${id}' ORDER BY c.created_at`,
  );
  console.log(`[seed-store-defaults] ${storeId}: menus ${menus.map((menu) => `${menu.handle} (${menu.items} items)`).join(", ")}`);
  console.log(`[seed-store-defaults] ${storeId}: collections ${collections.map((collection) => `${collection.handle} (${collection.products} products)`).join(", ")}`);
}

void main();
