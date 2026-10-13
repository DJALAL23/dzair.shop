// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The catalog's own gate — Phase 7 of the theme-foundation pass.
 *
 * The catalog is the theme's menu: which sections exist, what each is called,
 * and which fields a merchant may edit. It was previously validated only as a
 * *side effect* of the home-adsorption test, which meant deleting that test
 * silently removed the validation. This file is the deliberate home for it.
 *
 * The split of responsibilities, so nothing is asserted twice:
 *
 * - **here** — the menu is well-formed, grouped, correctly identified, and its
 *   editable fields agree with the shipped content pack;
 * - **home-adsorption.test.ts** — the shipped *document* only references
 *   sections this catalog declares, and renders through the real pipeline.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateThemeDefinition } from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import { en } from "@/theme/content/en";

describe("the theme's version", () => {
  it("is one version: package.json is the release, defineTheme the contract — they must agree", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(theme00.version).toBe(pkg.version);
  });
});

describe("the catalog is valid", () => {
  it("passes the SDK's catalog validator with no issues", () => {
    // One assertion covering type-key format, key⇄type identity, field rules
    // (including contentKey/default exclusivity), slot rules, capabilities and
    // load types.
    expect(validateThemeDefinition(theme00)).toEqual([]);
  });
});

describe("the catalog's identity is deliberate", () => {
  it("is named `theme-00`", () => {
    // ADR 0004: a catalog key names the *catalog*. Renaming it is a breaking
    // change for every saved document that references these type keys, so it
    // is pinned here rather than changed by accident.
    expect(theme00.key).toBe("theme-00");
  });

  it("carries a semver catalog version", () => {
    // ADR 0004: `ThemeDefinition.version` is the catalog's revision — the value
    // a future migration would target. The has-a-string rule the SDK enforces
    // is weaker than this on purpose.
    expect(theme00.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the catalog is editor-ready", () => {
  it("groups every definition — a palette is never ungrouped", () => {
    // `group` is optional in the SDK contract, so the validator cannot catch a
    // missing one. A Studio palette groups by it, and an ungroupped section
    // would land in a nameless bucket, so the theme's own convention is pinned.
    const ungrouped = Object.values(theme00.components)
      .filter((definition) => !definition.group)
      .map((definition) => definition.type);

    expect(ungrouped).toEqual([]);
  });
});

describe("the catalog and the content pack agree", () => {
  it("resolves every contentKey in the real pack", () => {
    // The catalog and the pack are code-owned and authored separately, so their
    // agreement is otherwise an unverified assumption. The SDK's opt-in
    // content-key check is what turns it into one — and it is the reason
    // theme-00 is the first theme to exercise that check for real.
    expect(
      validateThemeDefinition(theme00, { contentKeys: Object.keys(en) }),
    ).toEqual([]);
  });
});