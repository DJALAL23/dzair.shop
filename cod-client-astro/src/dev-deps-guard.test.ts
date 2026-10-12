/**
 * The dev server must pre-bundle every dependency at startup.
 *
 * A component loaded with `lazy(() => import(...))` — the rich-text editors —
 * is invisible to Vite's startup scan from the pages. Without these settings
 * its libraries are discovered on first use, Vite re-bundles mid-request, and
 * the editor's imports 404: the product page showed the plain-text fallback
 * (or, before the error boundaries, went blank). The production build is not
 * affected, which is why only this guard can catch a regression.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(join(import.meta.dirname, "../astro.config.mjs"), "utf8");

describe("dev-server dependency pre-bundling", () => {
  it("scans every source module, so lazily loaded components' libraries are bundled at startup", () => {
    expect(config).toMatch(/optimizeDeps:\s*\{\s*entries:\s*\[\s*"src\/\*\*\/\*\.\{ts,tsx\}"/);
  });

  it("gives the dev server its own cache, so `astro check` and builds never overwrite it mid-session", () => {
    // Proven: with one shared cache, `astro check` rewrote 38 pre-bundled
    // dependencies down to 14 under a running dev server, and every island
    // of the open dashboard 404'd.
    expect(config).toMatch(/cacheDir:\s*devServer \? "node_modules\/\.vite-dev"/);
  });

  it("declares the server modules a cold start would otherwise discover late", () => {
    for (const module of [
      "astro/assets/services/noop",
      "astro/logger/console",
      "drizzle-orm/d1",
      "better-auth",
      "better-auth/plugins",
      "better-auth-cloudflare",
    ]) {
      expect(config).toContain(`"${module}"`);
    }
  });
});
