/**
 * The shipped theme source the guard tests police: every `.ts` and `.astro`
 * file under `src/`, excluding build output, dependencies and test code
 * (`__tests__/` folders and `*.test.*` files). One collector, so every guard
 * agrees on what "the theme" is.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** The theme package root (`src/theme/__tests__/guards` → package root). */
export const THEME_ROOT = resolve(__dirname, "../../../..");
export const SRC_DIR = join(THEME_ROOT, "src");

export interface SourceFile {
  /** Path relative to `src/`, `/`-separated. */
  relPath: string;
  content: string;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "__tests__"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".astro")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

export function themeSourceFiles(): SourceFile[] {
  return walk(SRC_DIR, []).map((full) => ({
    relPath: relative(SRC_DIR, full).split(sep).join("/"),
    content: readFileSync(full, "utf8"),
  }));
}
