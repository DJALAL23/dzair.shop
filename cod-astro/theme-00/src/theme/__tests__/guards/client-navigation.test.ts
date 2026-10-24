import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

const files = themeSourceFiles();
const contentOf = (relPath: string) => files.find((file) => file.relPath === relPath)!.content;

describe("client-side navigation", () => {
  it("binds page scripts through the SDK's lifecycle, never on DOMContentLoaded alone", () => {
    const offenders = files
      .filter((file) => file.relPath.endsWith(".ts"))
      .filter((file) => /DOMContentLoaded|document\.readyState/.test(file.content))
      .map((file) => file.relPath);
    expect(offenders).toEqual([]);
    // The swap events are the SDK's to name: a theme that listens for them itself runs a second lifecycle.
    const ownLifecycle = files.filter((file) => /["'](?:wocart:section-load|astro:page-load|astro:before-swap)["']/.test(file.content)).map((file) => file.relPath);
    expect(ownLifecycle).toEqual([]);
    const binders = files.filter((file) => /from "@wocart\/theme\/lifecycle"/.test(file.content));
    expect(binders.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps native order forms out of the router", () => {
    const postForms = files.flatMap((file) =>
      [...file.content.matchAll(/<form\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => /method="POST"/.test(tag))
        .map((tag) => ({ file: file.relPath, tag })),
    );
    expect(postForms.length).toBeGreaterThan(0);
    expect(postForms.filter((form) => !form.tag.includes("data-astro-reload"))).toEqual([]);
  });

  it("gives checkout and the thank-you page a fresh document", () => {
    expect(contentOf("pages/checkout.astro")).toContain("softNavigation={false}");
    expect(contentOf("pages/thank-you.astro")).toContain("softNavigation={false}");
  });

  it("keeps Turnstile pages on full loads when the widget is enabled", () => {
    for (const page of ["pages/products/[slug].astro", "pages/lp/[slug].astro"]) {
      expect(contentOf(page)).toContain("softNavigation={!turnstileOn}");
      expect(contentOf(page)).toContain("config.turnstileEnabled === true && Boolean(config.turnstileSiteKey)");
    }
  });

  it("animates page changes with keyframes the stylesheet defines", () => {
    const motion = [...contentOf("theme/layouts/StoreLayout.astro").matchAll(/name: "([a-z-]+)"/g)].map((m) => m[1]);
    const stylesheet = readFileSync(path.resolve(process.cwd(), "src/theme/styles/global.css"), "utf8");
    expect(motion.length).toBeGreaterThan(0);
    for (const name of motion) expect(stylesheet).toContain(`@keyframes ${name} {`);
  });

  it("routes language changes through a full page load", () => {
    expect(contentOf("theme/components/layout/LanguageSwitcher.astro")).toContain("data-astro-reload");
  });
});
