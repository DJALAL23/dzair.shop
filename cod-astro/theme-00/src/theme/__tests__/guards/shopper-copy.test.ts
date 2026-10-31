import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

const read = (relPath: string) => readFileSync(path.resolve(process.cwd(), "src", relPath), "utf8");

describe("what a shopper reads", () => {
  it("never shows the server's own error text in the review form", () => {
    expect(read("theme/components/product/ReviewForm.astro")).not.toMatch(/json\.error/);
  });

  it("never shows a raw server or framework message from an order", () => {
    const outcome = read("theme/pages/order-outcome.ts");
    expect(outcome).not.toMatch(/error\.message/);
    expect(outcome).not.toMatch(/error instanceof Error/);
  });

  it("is asked for no consent in a form: the store's legal pages are linked in the footer", () => {
    const consent = /consent|توافق على|vous acceptez|you agree/i;
    expect(themeSourceFiles().filter((file) => consent.test(file.content)).map((file) => file.relPath)).toEqual([]);
  });
});
