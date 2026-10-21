/**
 * Shoppers' browsers never download a validator.
 *
 * The SDK checks data where it enters, on the server. Browser code reads what
 * it checked by its type, or — where a page cached apart from its scripts
 * could hold another version's shape — with the SDK's readers
 * (`readShippingRates`, `readCouponOutcome`, `isWilayaId`). A schema imported
 * by browser code ships Zod, about 27 KB compressed, in every page that loads
 * it; the SDK's own test keeps its browser exports free of one, and this keeps
 * the theme's browser code from bringing one back.
 */
import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

/** The runtime imports of a piece of source: `import type` and `type` names left out. */
function runtimeImports(source: string): Array<{ from: string; names: string[] }> {
  return [...source.matchAll(/import\s+(type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*\{([^}]*)\})?\s*(?:from\s*)?["']([^"']+)["']/g)]
    .filter((match) => !match[1])
    .map((match) => ({
      from: match[4]!,
      names: `${match[2] ?? ""},${match[3] ?? ""}`
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "" && !name.startsWith("type ")),
    }));
}

/** The theme's browser code: its scripts and bridges, and the `<script>` blocks Astro bundles for components and pages. */
function browserSources(): Array<{ file: string; source: string }> {
  const sources: Array<{ file: string; source: string }> = [];
  for (const { relPath, content } of themeSourceFiles()) {
    if (relPath.startsWith("theme/scripts/") || relPath.startsWith("theme/bridges/")) sources.push({ file: relPath, source: content });
    if (relPath.endsWith(".astro")) {
      for (const [, attributes, body] of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/\bis:inline\b/.test(attributes!)) sources.push({ file: `${relPath} <script>`, source: body! });
      }
    }
  }
  return sources;
}

describe("the theme's browser code", () => {
  it("is found, so this guard is checking something", () => {
    const files = browserSources().map(({ file }) => file);
    expect(files).toEqual(expect.arrayContaining(["theme/scripts/product.ts", "theme/scripts/delivery-fields.ts", "theme/scripts/otp-step.ts"]));
  });

  it("imports no schema from the SDK and nothing from Zod", () => {
    const offenders: string[] = [];
    for (const { file, source } of browserSources()) {
      for (const { from, names } of runtimeImports(source)) {
        if (from === "zod" || from.startsWith("zod/")) offenders.push(`${file}: imports zod`);
        if (from.startsWith("@wocart/")) for (const name of names.filter((name) => /Schema\b/.test(name))) offenders.push(`${file}: ${name} from ${from}`);
      }
    }
    expect(offenders, "Browser code must read what the server checked — by its type or with the SDK's readers — not re-check it with a schema").toEqual([]);
  });
});
