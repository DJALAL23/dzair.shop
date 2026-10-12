import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./error-boundary";

const SRC = join(import.meta.dirname, "../..");

function sourceFiles(directory: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(path, acc);
    else if ([".tsx", ".ts"].includes(extname(entry.name)) && !entry.name.includes(".test.")) acc.push(path);
  }
  return acc;
}

describe("ErrorBoundary", () => {
  it("renders its children until they throw, then the fallback", () => {
    const boundary = new ErrorBoundary({ fallback: "fallback", children: "page" });
    expect(boundary.render()).toBe("page");
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBe("fallback");
  });
});

describe("lazily loaded components", () => {
  it("scans the source tree (a broken walk must not pass vacuously)", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("are always wrapped in an ErrorBoundary — a failed chunk must never blank the page", () => {
    // A lazy import rejects whenever its chunk is gone: a deploy replaced it,
    // the network dropped, a dev server re-optimised. Unwrapped, React
    // unmounts the whole island and the merchant sees an empty page.
    const unguarded = sourceFiles(SRC)
      .filter((file) => /\blazy\(\s*\(\)\s*=>\s*import\(/.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("<ErrorBoundary"))
      .map((file) => relative(SRC, file));
    expect(unguarded).toEqual([]);
  });

  it("the chrome contains any page failure inside the dashboard", () => {
    const chrome = readFileSync(join(SRC, "components/layout/chrome.tsx"), "utf8");
    expect(chrome).toMatch(/<ErrorBoundary[\s\S]*\{children\}[\s\S]*<\/ErrorBoundary>/);
  });
});
