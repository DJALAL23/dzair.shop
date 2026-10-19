#!/usr/bin/env -S npx tsx
/**
 * Sets a store up, from the one source of seed data (cod-shared/starter, the
 * same SQL the Cloud's deployment runs):
 *
 *   1. the store row and its storefront API key, when the store has none yet;
 *   2. what every store starts with (`storeDefaultsSql`): the header and
 *      footer menus, the default collections, the four legal pages and a
 *      default shipping profile — each only where the store lacks it;
 *   3. with `--images=<dir>`, for a store with no catalog of its own, the
 *      starter catalog (`demoCatalogSql`), its pictures (`starter-<name>.webp`
 *      in <dir>) put in the store's R2 bucket first.
 *
 * Running it again changes nothing the store has.
 *
 * Usage:
 *   npx tsx scripts/seed-store.ts [--remote] [--store-id=<id>] [--images=<dir>] [--media-origin=<url>]
 *   [--persist-to=<dir>]   local state elsewhere than ../.wrangler-shared
 *
 * The storefront API key is $STORE_API_KEY, else cod-astro/theme-00/.dev.vars,
 * else — locally only — a dev default; a remote store is given a key only
 * from $STORE_API_KEY. Pictures are served from `--media-origin`, else the
 * local server's /images route (`npm run dev`, port 8787) and, remotely, the
 * media domain (COD_MEDIA_DOMAIN).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getCloudEnv } from "./cloud-env.mjs";
import { isStoreLocale } from "../../cod-shared/i18n/locales";
import { STARTER_IMAGES, demoCatalogSql, starterCatalogApplies, starterImageKey, starterPrefix, storeDefaultsSql } from "../../cod-shared/starter";

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const remote = args.includes("--remote");
const storeId = option("store-id") ?? "store-local-dev";
const imagesDir = option("images");

const cwd = join(__dirname, "..");
const { dbName, bucketName, mediaDomain } = getCloudEnv();
const where = remote ? "--remote" : `--local --persist-to "${option("persist-to") ?? "../.wrangler-shared"}"`;
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

function query<T>(sql: string): T[] {
  const out = execSync(`npx wrangler d1 execute ${dbName} ${where} --json --command "${sql.replace(/"/g, '\\"')}"`, { cwd, stdio: "pipe" }).toString();
  return (JSON.parse(out) as Array<{ results?: T[] }>)[0]?.results ?? [];
}

function execute(statements: readonly string[]): void {
  if (statements.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), "seed-store-"));
  const file = join(dir, "seed.sql");
  writeFileSync(file, statements.map((statement) => `${statement};`).join("\n"));
  try {
    execSync(`npx wrangler d1 execute ${dbName} ${where} --file "${file}"${remote ? " -y" : ""}`, { cwd, stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function storeApiKey(): string | null {
  if (process.env.STORE_API_KEY) return process.env.STORE_API_KEY;
  if (remote) return null;
  try {
    const match = readFileSync(resolve(cwd, "../cod-astro/theme-00/.dev.vars"), "utf8").match(/^STORE_API_KEY=(.+)$/m);
    if (match) return match[1]!.trim();
  } catch {}
  return "codflow-dev-store-key";
}

function mediaOrigin(): string {
  const given = option("media-origin");
  if (given) return given;
  if (!remote) return "http://localhost:8787/images";
  if (mediaDomain === "media.example.com") throw new Error("Set COD_MEDIA_DOMAIN in the root .env, or pass --media-origin=<url>.");
  return `https://${mediaDomain}`;
}

async function main() {
  const now = new Date().toISOString();
  const key = storeApiKey();
  let store = query<{ id: string; name: string; lang: string }>(`SELECT id, name, lang FROM stores WHERE id = ${q(storeId)}`)[0];
  if (!store && !key) throw new Error(`No store "${storeId}" yet: give its storefront API key as STORE_API_KEY.`);
  if (key) {
    const hash = createHash("sha256").update(key).digest("hex");
    execute([
      `INSERT OR IGNORE INTO stores (id, name, lang, currency, currency_symbol, created_at, updated_at) VALUES (${q(storeId)}, 'متجر التطوير', 'ar', 'DZD', 'دج', ${q(now)}, ${q(now)})`,
      `INSERT OR IGNORE INTO store_locales (store_id, locale, published, created_at) SELECT id, lang, 1, ${q(now)} FROM stores WHERE id = ${q(storeId)}`,
      `INSERT OR REPLACE INTO store_api_keys (id, store_id, key_hash, name, created_at) VALUES (${q(`key-${storeId.replace(/^store-/, "")}`)}, ${q(storeId)}, ${q(hash)}, 'default', ${q(now)})`,
      `UPDATE stores SET store_api_key = ${q(key)} WHERE id = ${q(storeId)}`,
    ]);
    store = query<{ id: string; name: string; lang: string }>(`SELECT id, name, lang FROM stores WHERE id = ${q(storeId)}`)[0];
  }
  if (!store || !isStoreLocale(store.lang)) throw new Error(`Store "${storeId}" has no language this platform supports.`);
  const starter = { id: store.id, name: store.name, lang: store.lang };

  execute(await storeDefaultsSql(starter, now));
  console.log(`[seed-store] ${storeId}: menus, collections, legal pages and shipping are in place`);

  if (!imagesDir) {
    console.log("[seed-store] no starter catalog: pass --images=<dir> with its pictures (starter-<name>.webp) to add it");
    return;
  }
  const prefix = q(starterPrefix(store.id));
  const [{ applies, present }] = query<{ applies: number; present: number }>(
    `SELECT ${starterCatalogApplies(store.id)} AS applies, EXISTS (SELECT 1 FROM products WHERE substr(id, 1, length(${prefix})) = ${prefix}) AS present`,
  );
  if (!applies) {
    console.log(`[seed-store] ${storeId} has a catalog of its own: no starter catalog`);
    return;
  }
  if (present) {
    console.log(`[seed-store] ${storeId} already has the starter catalog`);
    return;
  }
  const files = STARTER_IMAGES.map((name) => ({ key: starterImageKey(name), file: resolve(imagesDir, `starter-${name}.webp`) }));
  const missing = files.filter(({ file }) => !existsSync(file));
  if (missing.length) throw new Error(`Missing starter pictures: ${missing.map(({ file }) => file).join(", ")}`);
  for (const { key, file } of files) {
    execSync(`npx wrangler r2 object put "${bucketName}/${key}" --file "${file}" --content-type image/webp ${where}`, { cwd, stdio: "pipe" });
  }
  execute(await demoCatalogSql(starter, { mediaOrigin: mediaOrigin(), now }));
  console.log(`[seed-store] ${storeId}: starter catalog added, pictures in ${bucketName}`);
}

main().catch((error: Error) => {
  console.error(`[seed-store] ${error.message}`);
  process.exit(1);
});
