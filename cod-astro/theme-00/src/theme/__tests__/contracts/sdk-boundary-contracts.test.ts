// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Theme-00 is a consumer of the SDKs, not part of them. It may reach the SDKs
 * only through what a third-party theme could install: the published entry
 * points in each package's `exports` map. A deep import or a relative path into
 * `cod-sdk/` would let Theme-00 depend on something another theme cannot have.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_FILE = /\.(ts|tsx|astro|mjs|js)$/;
const SDK_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](@codflow\/[^"']+)["']/g;
const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(entry) ? [full] : [];
  });
}

/** The `exports` subpaths of an installed `@codflow/*` package, as import specifiers. */
function publishedEntryPoints(packageName: string): Set<string> {
  let dir = process.cwd();
  while (true) {
    const manifest = path.join(dir, "node_modules", packageName, "package.json");
    if (existsSync(manifest)) {
      const { exports } = JSON.parse(readFileSync(manifest, "utf8")) as {
        exports: Record<string, unknown>;
      };
      return new Set(
        Object.keys(exports).map((subpath) =>
          subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`,
        ),
      );
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${packageName} is not installed`);
    dir = parent;
  }
}

const files = sourceFiles(SOURCE_ROOT);
const allowed = new Set([
  ...publishedEntryPoints("@codflow/theme"),
  ...publishedEntryPoints("@codflow/storefront"),
]);

describe("Theme-00 consumes the SDKs only through published entry points", () => {
  it("scans the theme's sources", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("imports @codflow/* only by an exported subpath", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(SDK_IMPORT)) {
        const specifier = match[1] as string;
        if (!allowed.has(specifier)) {
          violations.push(`${path.relative(SOURCE_ROOT, file)}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never reaches into the SDK folders by relative path", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
        const target = path.resolve(path.dirname(file), match[1] as string);
        if (target.includes(`${path.sep}cod-sdk${path.sep}`)) {
          violations.push(`${path.relative(SOURCE_ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
