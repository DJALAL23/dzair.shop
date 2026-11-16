/**
 * The Media module's boundary (ADR 0021), read from the source of cod-server
 * and cod-shared: the store's bucket is reached only through the R2 host, so
 * a store on another host needs none; no file waits anywhere before the
 * store's host keeps it; no code reads a column Media Keys replaced; nothing
 * of the system before them is left.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SOURCES = ["cod-server/src", "cod-shared"].map((dir) => join(ROOT, dir));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "migrations", "test-utils", "testing"].includes(entry.name) ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const FILES = SOURCES.flatMap(sourceFiles).map((path) => ({ path: relative(ROOT, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

/** Each line of a file matching `pattern`, as `path:line: text`. */
function matches(pattern: RegExp, files = FILES): string[] {
  return files.flatMap(({ path, text }) =>
    text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe("the store's bucket", () => {
  it("is handed only to the R2 host, when the store keeps its media there", () => {
    const uses = matches(/MEDIA_BUCKET/).filter((use) => !use.startsWith("cod-server/src/types/env.ts:"));
    expect(uses.map((use) => use.split(":")[0])).toEqual(["cod-server/src/lib/media.ts", "cod-server/src/lib/media.ts"]);
    expect(uses[0]).toMatch(/if \(!env\.MEDIA_BUCKET\) throw new MediaError\("not_configured"/);
    expect(uses[1]).toMatch(/r2Host\(\{ binding: env\.MEDIA_BUCKET \}\)/);
  });

  it("is used as a bucket only by the R2 host", () => {
    const owners = new Set(["cod-shared/media/hosts/r2.ts", "cod-server/src/types/env.ts"]);
    expect(matches(/\bR2Bucket\b/).filter((use) => !owners.has(use.split(":")[0]!))).toEqual([]);
  });

  it("is optional: a store on ImageKit has none", () => {
    expect(matches(/MEDIA_BUCKET\??:/, FILES.filter(({ path }) => path === "cod-server/src/types/env.ts"))).toEqual([expect.stringContaining("MEDIA_BUCKET?: R2Bucket;")]);
  });
});

describe("Staging (removed by migration 0091)", () => {
  it("is gone: every file is kept by the store's host as it arrives", () => {
    expect(matches(/staging\/|\bstaging\(|\bStaging\b|STAGING_PREFIX/)).toEqual([]);
  });
});

describe("the columns Media Keys replaced (dropped by migration 0069)", () => {
  it("are read by no code", () => {
    const outsideSchema = FILES.filter(({ path }) => path !== "cod-shared/db/schema.ts");
    const drizzle = /\b(productImages|landingPageImages|reviewMedia)\.(src|r2Key|srcSm|srcMd|srcLg)\b|\bproductCategories\.imageUrl\b|\bstores\.(logoUrl|ogImage)\b/;
    const sql = /\b(r2_key|image_url|logo_url|og_image|src_sm|src_md|src_lg)\b|\bpi\.src\b/;
    expect(matches(drizzle, outsideSchema)).toEqual([]);
    expect(matches(sql, outsideSchema)).toEqual([]);
  });
});

describe("the media system before Media Keys", () => {
  it("is gone", () => {
    expect(matches(/MEDIA_DOMAIN|R2_BUCKET_NAME|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|CF_ACCOUNT_ID|\benv\.IMAGES\b|@aws-sdk|review-uploads\/|endpoints\/images\//)).toEqual([]);
  });
});
