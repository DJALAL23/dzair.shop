/**
 * Store-context seam (Theme Zero S2).
 *
 * The SDK's `createStorefrontMiddleware` resolves each request's store, and
 * this theme's `storeContext()` (`theme/runtime/store.ts`) builds the context
 * from it; middleware runs once per request and puts the result on
 * `Astro.locals.store`; pages, layouts and
 * components read that — its language, links and SDK client included. These
 * guards keep the seam single so a new page (or a new theme) has exactly one
 * pattern to copy, and a second acquisition point fails here.
 */
import { describe, expect, it } from "vitest";

import { type SourceFile, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();

describe("Theme Zero — one store-context acquisition point", () => {
  it("scans the source tree (a broken walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("only middleware acquires the store context", () => {
    const owners = (pattern: RegExp) =>
      files
        .filter((f) => pattern.test(f.content))
        .map((f) => f.relPath)
        .sort();

    // The SDK resolves the request in one place: the middleware.
    expect(owners(/\bcreateStorefrontMiddleware\s*\(/)).toEqual(["middleware.ts"]);
    // Nothing resolves a store by hand beside it.
    expect(owners(/\b(resolveStoreRequest|resolvePreviewStore)\s*\(/)).toEqual([]);
    // store.ts defines the context; middleware hands it to the SDK. Anyone else is a second seam.
    expect(owners(/\bstoreContext\b/)).toEqual(["middleware.ts", "theme/runtime/store.ts"]);
  });

  it("only the adapter and the middleware's own store module create SDK clients; pages use the request's", () => {
    const creators = files
      // A call or a hand-off (the runtime gives the factory to the SDK's resolver), never an import alone.
      .filter((f) => /\bgetStoreClient\b/.test(f.content.replace(/^import[^;]*;$/gm, "")))
      .map((f) => f.relPath)
      .filter((path) => !path.startsWith("pages/api/") && !path.startsWith("actions/"))
      .sort();

    // Endpoints and actions are language-neutral writes; everything that
    // renders reads `Astro.locals.store.client`, the request's language.
    expect(creators).toEqual(["theme/runtime/store.ts", "theme/sdk.ts"]);
  });

  it("every internal link is built in the request's language", () => {
    const raw = files
      .filter((f) => f.relPath.endsWith(".astro"))
      .flatMap((f) =>
        [...f.content.matchAll(/(?:href|data-[a-z-]*href)=(?:"\/(?!\/)[^"]*"|\{`\/[^`]*`\})/g)]
          .map((m) => m[0])
          .filter((attr) => !/\.[a-z0-9]+"$/.test(attr))
          .map((attr) => `${f.relPath}: ${attr}`),
      );

    // `Astro.locals.store.href(...)` — never a bare "/path" that drops a
    // `/fr/` shopper back into the primary language.
    expect(raw).toEqual([]);
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
