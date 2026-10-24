/**
 * What a review refusal says — every code the platform names has its own
 * words, in every language, and the form embeds them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_REFUSAL_CODES, REVIEW_TEXT_LIMITS } from "@wocart/storefront";
import { ar } from "@/theme/content/ar";
import { en } from "@/theme/content/en";
import { fr } from "@/theme/content/fr";
import { reviewRefusalKey } from "../review-refusals";

/** The form's copy keys and the pack strings it embeds them from (`errorGrant: c.reviewFormErrorGrant`). */
const formCopy = new Map(
  [...readFileSync(resolve(process.cwd(), "src/theme/components/product/ReviewForm.astro"), "utf8").matchAll(/^\s+(\w+): c\.(\w+),$/gm)].map((match) => [match[1]!, match[2]!]),
);

describe("what a review refusal says", () => {
  it("words every code the platform names, each its own way, embedded in the form in every language", () => {
    const keys = REVIEW_REFUSAL_CODES.map((code) => reviewRefusalKey(code, "find"));
    expect(keys).not.toContain("errorGeneric");
    expect(new Set(keys).size).toBe(REVIEW_REFUSAL_CODES.length);
    for (const key of [...keys, "errorGeneric"]) {
      const packKey = formCopy.get(key);
      expect(packKey, key).toBeDefined();
      for (const [locale, pack] of [["ar", ar], ["fr", fr], ["en", en]] as const) {
        expect((pack as unknown as Record<string, string>)[packKey!], `${locale} ${packKey}`).toBeTruthy();
      }
    }
  });

  it("reads a malformed review at submit as too short, and an unknown code or no answer as the general sentence", () => {
    expect(reviewRefusalKey("VALIDATION_FAILED", "submit")).toBe("minLength");
    expect(reviewRefusalKey("VALIDATION_FAILED", "find")).toBe("errorOrderFormat");
    expect(reviewRefusalKey("ORDER_NOT_FOUND", "submit")).toBe("errorInvalidOrder");
    expect(reviewRefusalKey("A_CODE_FROM_A_NEWER_SERVER", "upload")).toBe("errorGeneric");
    expect(reviewRefusalKey(null, "submit")).toBe("errorGeneric");
    expect(reviewRefusalKey("hasOwnProperty", "find")).toBe("errorGeneric");
  });

  it("says the platform's own shortest review in every language, so the words never drift from the rule", () => {
    // The sentence keeps the key merchants may have edited since 3.0.3, so it names the figure itself.
    expect(formCopy.get("minLength")).toBe("reviewFormMinLengthError");
    for (const [locale, pack] of [["ar", ar], ["fr", fr], ["en", en]] as const) {
      expect(pack.reviewFormMinLengthError, locale).toContain(String(REVIEW_TEXT_LIMITS.bodyMin));
    }
    expect(reviewRefusalKey("VALIDATION_FAILED", "submit")).toBe("minLength");
  });
});
