// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Theme-00 is a consumer of the SDKs, not part of them. It installs them from the
 * npm registry like any third-party theme, and reaches them only through the
 * published entry points in each package's `exports` map. A deep import or a relative path into
 * the SDKs' source would let Theme-00 depend on something another theme cannot have.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_FILE = /\.(ts|tsx|astro|mjs|js)$/;
const SDK_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](@wocart\/[^"']+)["']/g;
const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(entry) ? [full] : [];
  });
}

/** The `exports` subpaths of an installed `@wocart/*` package, as import specifiers. */
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
  ...publishedEntryPoints("@wocart/theme"),
  ...publishedEntryPoints("@wocart/storefront"),
]);

const SDK_PACKAGES = ["@wocart/storefront", "@wocart/theme"] as const;

describe("Theme-00 installs the SDKs from the npm registry", () => {
  const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.resolve(process.cwd(), "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; resolved?: string; integrity?: string; link?: boolean }>;
  };

  it.each(SDK_PACKAGES)("pins %s to one exact published version", (name) => {
    expect(manifest.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(SDK_PACKAGES)("locks %s to the registry tarball of that version", (name) => {
    const entry = lock.packages[`node_modules/${name}`];
    const version = manifest.dependencies[name];
    expect(entry?.link).toBeUndefined();
    expect(entry?.version).toBe(version);
    expect(entry?.resolved).toBe(
      `https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${version}.tgz`,
    );
    expect(entry?.integrity).toMatch(/^sha512-/);
  });

  it.each(SDK_PACKAGES)("has %s installed as a package, not a link into the repository", (name) => {
    expect(lstatSync(path.resolve(process.cwd(), "node_modules", name)).isSymbolicLink()).toBe(false);
  });
});

describe("Theme-00 consumes the SDKs only through published entry points", () => {
  it("scans the theme's sources", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("imports @wocart/* only by an exported subpath", () => {
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
        if (target.includes(`${path.sep}wocart-sdk${path.sep}`)) {
          violations.push(`${path.relative(SOURCE_ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
