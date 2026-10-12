/**
 * Store-context seam (Theme Zero S2).
 *
 * `getStoreContext()` is the middleware's dependency: middleware runs once per
 * request and puts the result on `Astro.locals.store`; pages and layouts read
 * that. These guards keep the seam single so a new page (or a new theme) has
 * exactly one pattern to copy, and a second acquisition point fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

const THEME_ROOT = resolve(__dirname, "../../../.."); // src/theme/__tests__/guards -> theme package root
const SRC_DIR = join(THEME_ROOT, "src");

interface SourceFile {
  relPath: string;
  content: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".astro")) &&
      !entry.name.includes(".test.")
    )
      out.push(full);
  }
  return out;
}

const files: SourceFile[] = walk(SRC_DIR).map((full) => ({
  relPath: relative(SRC_DIR, full).split(sep).join("/"),
  content: readFileSync(full, "utf8"),
}));

describe("Theme Zero — one store-context acquisition point", () => {
  it("scans the source tree (a broken walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("only middleware acquires the store context", () => {
    const owners = files
      .filter((f) => f.content.includes("getStoreContext("))
      .map((f) => f.relPath)
      .sort();

    // store.ts defines it; middleware calls it. Anyone else is a second seam.
    expect(owners).toEqual(["middleware.ts", "theme/runtime/store.ts"]);
  });

  it("the layout reads context from locals and takes no content prop", () => {
    const layout = files.find((f) => f.relPath === "theme/layouts/StoreLayout.astro");

    expect(layout?.content).toContain("Astro.locals.store");
    expect(layout?.content).not.toContain("content: StoreFrontContent");
    expect(layout?.content).not.toContain("content?:");
  });

  it("every page that renders the shell reads the context from locals", () => {
    const offenders = files
      .filter((f) => f.relPath.startsWith("pages/") && f.content.includes("<StoreLayout"))
      .filter((f) => !f.content.includes("Astro.locals.store"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });
});
