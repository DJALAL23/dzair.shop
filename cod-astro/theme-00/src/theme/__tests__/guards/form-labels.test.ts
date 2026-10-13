import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

describe("form labels", () => {
  it("every label points at an element that exists in the same component", () => {
    const broken = themeSourceFiles()
      .filter((file) => file.relPath.endsWith(".astro"))
      .flatMap((file) =>
        [...file.content.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)]
          .map((match) => match[1])
          .filter((target) => !new RegExp(`\\bid="${target}"`).test(file.content))
          .map((target) => `${file.relPath} → ${target}`),
      );
    expect(broken).toEqual([]);
  });
});
