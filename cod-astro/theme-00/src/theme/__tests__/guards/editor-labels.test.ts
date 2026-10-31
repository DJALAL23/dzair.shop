/**
 * Every word the editor shows for this theme names something a merchant can
 * edit: a label no definition uses is a translation kept up in three
 * languages for nothing, and a sign a field went missing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_DIR, themeSourceFiles } from "./theme-source";

describe("the editor's labels", () => {
  it("are each used by a definition, a setting or a surface", () => {
    const labels = readFileSync(join(SRC_DIR, "theme/catalog/labels.ts"), "utf8");
    const source = themeSourceFiles()
      .filter((file) => file.relPath !== "theme/catalog/labels.ts")
      .map((file) => file.content)
      .join("\n");
    const names = [...labels.matchAll(/export const (\w+) = \{([\s\S]*?)\n\};/g)].flatMap(([, group, body]) =>
      [...body!.matchAll(/^ {2}(\w+):/gm)].map(([, key]) => `${group}.${key}`),
    );
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((name) => !new RegExp(`\\b${name.replace(".", "\\.")}\\b`).test(source))).toEqual([]);
  });
});
