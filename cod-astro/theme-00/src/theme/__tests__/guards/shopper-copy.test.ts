import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
});
