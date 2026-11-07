/**
 * The editor's word groups: every word of every pack is found under a named
 * part of the store, words for screen readers under their own, and the
 * groups pass the SDK's checks.
 */
import { describe, expect, it } from "vitest";
import { groupContentKeys, themeManifest, validateThemeDefinition } from "@wocart/theme";
import { theme00 } from "../../theme";
import { ar } from "../ar";
import { en } from "../en";
import { fr } from "../fr";
import { CONTENT_GROUPS } from "../groups";

const byKey = (keys: string[]) => new Map(groupContentKeys(keys, CONTENT_GROUPS).flatMap(({ group, keys }) => keys.map((key) => [key, group?.key ?? null])));

describe("the theme's word groups", () => {
  it.each([["ar", ar], ["fr", fr], ["en", en]] as const)("hold every %s word, none left unnamed", (_, pack) => {
    const groups = groupContentKeys(Object.keys(pack), CONTENT_GROUPS);
    expect(groups.find(({ group }) => group === null)?.keys ?? []).toEqual([]);
  });

  it("put a word with the area its file belongs to, and screen-reader words apart", () => {
    const groups = byKey(Object.keys(ar));
    expect(groups.get("heroTitle")).toBe("home");
    expect(groups.get("navMenu")).toBe("layout");
    expect(groups.get("shippingLabel")).toBe("order-summary");
    expect(groups.get("lowStock_few")).toBe("general");
    expect(groups.get("ariaQuantity")).toBe("screen-readers");
    expect([...groups.values()].filter((group) => group === "screen-readers").length).toBeGreaterThan(5);
  });

  it("pass the SDK's checks and reach the editor in the manifest", () => {
    expect(validateThemeDefinition(theme00).filter((issue) => issue.path.startsWith("contentGroups"))).toEqual([]);
    expect(themeManifest(theme00).contentGroups?.map((group) => group.key)).toEqual(CONTENT_GROUPS.map((group) => group.key));
  });
});
