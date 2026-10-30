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
 *      in <dir>) put in the store's media first, on the host its Worker uses.
 *
 * Running it again changes nothing the store has.
 *
 * It runs on the Worker's own bindings and variables (wrangler.toml, and
 * .dev.vars locally): `DB`, `MEDIA_BUCKET`, `MEDIA_HOST` and what that host
 * needs. A secret the deployed Worker holds, like `IMAGEKIT_PRIVATE_KEY`, is
 * given remotely in the environment; the environment wins over the files.
 *
 * Usage:
 *   npx tsx scripts/seed-store.ts [--remote] [--store-id=<id>] [--images=<dir>]
 *   [--persist-to=<dir>]   local state elsewhere than ../.wrangler-shared
 *
 * The storefront API key is $STORE_API_KEY, else cod-astro/theme-00/.dev.vars,
 * else — locally only — a dev default; a remote store is given a key only
 * from $STORE_API_KEY.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { mediaOf } from "@/lib/media";
import type { Env } from "@/types/env";
import { isStoreLocale } from "../../cod-shared/i18n/locales";
import { STARTER_IMAGES, demoCatalogSql, starterCatalogApplies, starterPrefix, storeDefaultsSql, storeStarterPictures } from "../../cod-shared/starter";

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const remote = args.includes("--remote");
const storeId = option("store-id") ?? "store-local-dev";
const imagesDir = option("images");

const cwd = join(__dirname, "..");
const CONFIG = resolve(cwd, "wrangler.toml");
const MEDIA_VARS = ["MEDIA_HOST", "MEDIA_DELIVERY", "MEDIA_ORIGIN", "IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_PRIVATE_KEY", "IMAGEKIT_FOLDER"] as const;
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The Worker's `DB` and `MEDIA_BUCKET` with its variables: the local state, or the deployed resources. */
async function platform(): Promise<{ env: Env; dispose: () => Promise<void> }> {
  if (!remote) {
    const proxy = await getPlatformProxy<Env>({ configPath: CONFIG, persist: { path: resolve(cwd, option("persist-to") ?? "../.wrangler-shared", "v3") } });
    return { env: withProcessEnv(proxy.env), dispose: proxy.dispose };
  }
  const config = unstable_readConfig({ config: CONFIG });
  const database = config.d1_databases.find((binding) => binding.binding === "DB");
  const bucket = config.r2_buckets.find((binding) => binding.binding === "MEDIA_BUCKET");
  if (!database?.database_id || !bucket?.bucket_name) throw new Error("wrangler.toml declares no DB database or MEDIA_BUCKET bucket.");
  const dir = mkdtempSync(join(tmpdir(), "seed-store-"));
  const configPath = join(dir, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: `${config.name}-seed`,
      account_id: config.account_id,
      compatibility_date: config.compatibility_date,
      d1_databases: [{ binding: "DB", database_name: database.database_name, database_id: database.database_id, remote: true }],
      r2_buckets: [{ binding: "MEDIA_BUCKET", bucket_name: bucket.bucket_name, remote: true }],
      vars: config.vars,
    }),
  );
  try {
    const proxy = await getPlatformProxy<Env>({ configPath, persist: false, envFiles: [] });
    return {
      env: withProcessEnv(proxy.env),
      dispose: async () => {
        await proxy.dispose();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function withProcessEnv(env: Env): Env {
  const given = Object.fromEntries(MEDIA_VARS.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])));
  return { ...env, ...given };
}

async function execute(env: Env, statements: readonly string[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50).map((statement) => env.DB.prepare(statement)));
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

async function seed(env: Env) {
  const now = new Date().toISOString();
  const key = storeApiKey();
  const storeRow = () => env.DB.prepare("SELECT id, name, lang FROM stores WHERE id = ?1").bind(storeId).first<{ id: string; name: string; lang: string }>();
  let store = await storeRow();
  if (!store && !key) throw new Error(`No store "${storeId}" yet: give its storefront API key as STORE_API_KEY.`);
  if (key) {
    const hash = createHash("sha256").update(key).digest("hex");
    await execute(env, [
      `INSERT OR IGNORE INTO stores (id, name, lang, currency, currency_symbol, created_at, updated_at) VALUES (${q(storeId)}, 'متجر التطوير', 'ar', 'DZD', 'دج', ${q(now)}, ${q(now)})`,
      `INSERT OR IGNORE INTO store_locales (store_id, locale, published, created_at) SELECT id, lang, 1, ${q(now)} FROM stores WHERE id = ${q(storeId)}`,
      `INSERT OR REPLACE INTO store_api_keys (id, store_id, key_hash, name, created_at) VALUES (${q(`key-${storeId.replace(/^store-/, "")}`)}, ${q(storeId)}, ${q(hash)}, 'default', ${q(now)})`,
      `UPDATE stores SET store_api_key = ${q(key)} WHERE id = ${q(storeId)}`,
    ]);
    store = await storeRow();
  }
  if (!store || !isStoreLocale(store.lang)) throw new Error(`Store "${storeId}" has no language this platform supports.`);
  const starter = { id: store.id, name: store.name, lang: store.lang };

  await execute(env, await storeDefaultsSql(starter, now));
  console.log(`[seed-store] ${storeId}: menus, collections, legal pages and shipping are in place`);

  if (!imagesDir) {
    console.log("[seed-store] no starter catalog: pass --images=<dir> with its pictures (starter-<name>.webp) to add it");
    return;
  }
  const prefix = q(starterPrefix(store.id));
  const state = await env.DB.prepare(
    `SELECT ${starterCatalogApplies(store.id)} AS applies, EXISTS (SELECT 1 FROM products WHERE substr(id, 1, length(${prefix})) = ${prefix}) AS present`,
  ).first<{ applies: number; present: number }>();
  if (!state?.applies) {
    console.log(`[seed-store] ${storeId} has a catalog of its own: no starter catalog`);
    return;
  }
  const missing = STARTER_IMAGES.map((name) => resolve(imagesDir, `starter-${name}.webp`)).filter((file) => !existsSync(file));
  if (missing.length) throw new Error(`Missing starter pictures: ${missing.join(", ")}`);
  await storeStarterPictures(mediaOf(env), async (fileName) => new Uint8Array(await readFile(resolve(imagesDir, fileName))));
  await execute(env, await demoCatalogSql(starter, now));
  console.log(`[seed-store] ${storeId}: starter catalog ${state.present ? "in place" : "added"}, pictures on ${env.MEDIA_HOST}`);
}

async function main() {
  const { env, dispose } = await platform();
  try {
    await seed(env);
  } finally {
    await dispose();
  }
}

main().catch((error: Error) => {
  console.error(`[seed-store] ${error.message}`);
  process.exit(1);
});
