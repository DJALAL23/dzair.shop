import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_FILE = /\.(ts|tsx|astro|css|mjs|js|json)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(entry) ? [full] : [];
  });
}

describe("the storefront loads no fonts from third parties", () => {
  it("never references a font CDN from the theme's sources", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
      .filter((file) => /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SOURCE_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("declares every face through Astro's font API", () => {
    const config = readFileSync(path.resolve(process.cwd(), "astro.config.mjs"), "utf8");
    expect(config).toContain("fonts: themeFonts.map(");
    expect(config).toContain("provider: fontProviders.google()");
  });
});
