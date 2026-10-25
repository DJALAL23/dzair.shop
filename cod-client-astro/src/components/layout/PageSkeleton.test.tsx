import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageSkeleton } from "./PageSkeleton";

const withoutMarks = (html: string) => html.replace(/ data-(gate-spinner|auth-state)="[^"]*"/g, "");

describe("the page skeleton", () => {
  it("is the same markup in the static shell and while the session is checked", () => {
    const shell = renderToStaticMarkup(<PageSkeleton gate="required" />);
    const pending = renderToStaticMarkup(<PageSkeleton authState="pending" />);

    expect(shell).toContain('data-gate-spinner="required"');
    expect(pending).toContain('data-auth-state="pending"');
    expect(withoutMarks(shell)).toBe(withoutMarks(pending));
  });

  it("takes the page's place: its width and padding are the page content's", () => {
    const html = renderToStaticMarkup(<PageSkeleton />);
    expect(html).toMatch(/^<div data-skeleton="" role="status" aria-busy="true" class="mx-auto max-w-\[1144px\] px-4 pb-16 pt-5 sm:px-8 sm:pt-8">/);
  });
});

describe("the skeleton shimmer", () => {
  it("paints its whole box: shadcn's own shimmer utility clips the background to text, which leaves an empty bar blank", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");
    const rule = /\.shimmer \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/(?<!-webkit-)background-clip: border-box;/);
    expect(rule).toMatch(/-webkit-background-clip: border-box;/);
    expect(rule).toMatch(/-webkit-text-fill-color: currentColor;/);
    expect(css).toMatch(/@import "shadcn\/tailwind\.css";/);
  });
});
