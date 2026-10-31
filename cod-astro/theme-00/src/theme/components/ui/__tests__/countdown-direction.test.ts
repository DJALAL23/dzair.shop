/**
 * A countdown's clock reads left to right in every language and in both its
 * looks: in Arabic it once read seconds, minutes, hours. When it ends is the
 * SDK's rule (`countdownEnd`), tested there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("how a countdown reads", () => {
  it("runs its clock left to right in every language and look", () => {
    const source = readFileSync(resolve(__dirname, "../Countdown.astro"), "utf8");
    expect(source).toMatch(/\.countdown-parts \{[^}]*direction: ltr;[^}]*unicode-bidi: isolate;/);
    expect(source).toContain('from "@wocart/storefront"');
  });
});
