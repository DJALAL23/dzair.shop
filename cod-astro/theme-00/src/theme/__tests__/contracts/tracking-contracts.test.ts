/**
 * Which pixel the storefront fires at.
 *
 * These invariants live in page frontmatter and in inline scripts, so no unit
 * test can reach them and `astro check` is happy either way — the same class
 * of gap `page-contracts.test.ts` exists for.
 *
 * What they protect: Meta deduplicates a browser event against its server
 * mirror only when both reached the SAME pixel id (capi-deduplication.md). If
 * this theme ever decides a pixel for itself — from a slug in the URL, from
 * sessionStorage, from the store config on a page that has its own pixel — it
 * can pick a different one from the Conversions API, and Meta then records two
 * conversions in two ad accounts instead of merging them into one.
 *
 * So the rule is: the theme RENDERS a pixel the server resolved. It never
 * works one out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

/** The identifier a page hands to StoreLayout — what BaseHead initialises. */
function layoutConfigOf(source: string): string {
  const match = source.match(/<StoreLayout[\s\S]*?config=\{([A-Za-z0-9_$.]+)\}/);
  expect(match, "page must pass a config to StoreLayout").not.toBeNull();
  return match![1];
}

/** Every file of the theme's source: no pixel call may live anywhere in it. */
function themeSources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
      } else if (/\.(ts|astro)$/.test(name)) out.push({ path: full.slice(SRC.length + 1), text: readFileSync(full, "utf8") });
    }
  };
  walk(SRC);
  return out;
}

const landingSurface = read("theme/pages/LandingSurface.astro");
const thankYou = read("pages/thank-you.astro");
const baseHead = read("theme/components/layout/BaseHead.astro");
const storeLayout = read("theme/layouts/StoreLayout.astro");

describe("the theme calls no pixel itself", () => {
  it("names fbq nowhere: the SDK's storefrontTracking is the only caller", () => {
    for (const { path, text } of themeSources()) {
      expect(text, path).not.toMatch(/\bfbq\b|trackSingle|connect\.facebook\.net/);
    }
  });

  it("renders the head the SDK builds, from the pixel the layout is given", () => {
    expect(baseHead).toMatch(/set:html=\{trackingHead\(config\.pixelId\)\}/);
  });

  it("starts the page's tracking once, from the layout", () => {
    expect(storeLayout).toMatch(/storefrontTracking\(\)\.start\(\)/);
  });
});

describe("the landing page", () => {
  it("renders the pixel the server resolved for it, not the store's", () => {
    // `landing.tracking` is computed by cod-shared inside the batch the page
    // read runs. Falling back to `config.pixelId` would put a page with its
    // own pixel back on the store's.
    expect(landingSurface).toMatch(/const pageConfig = \{ \.\.\.config, pixelId: landing\.tracking\.pixelId \};/);
    expect(layoutConfigOf(landingSurface)).toBe("pageConfig");
    expect(landingSurface).not.toMatch(/config\.pixelId/);
  });
});

describe("the thank-you page", () => {
  it("asks the server which pixel this order belongs to, and loads that one", () => {
    // The page knows the order id and nothing else. Attribution is
    // best-effort server-side, so any slug it might read from the URL could
    // name a pixel the server never recorded against this order.
    expect(thankYou).toMatch(/orders\.tracking\(/);
    expect(thankYou).toMatch(/pixelId: tracking\?\.pixelId \?\? null/);
    expect(layoutConfigOf(thankYou)).toBe("pageConfig");
    expect(thankYou).not.toMatch(/config\.pixelId/);
  });

  it("renders the server's sale for the SDK to fire, never one of its own", () => {
    expect(thankYou).toMatch(/set:html=\{conversionTag\(tracking, total\)\}/);
    expect(thankYou).not.toMatch(/Purchase|eventID|conversionEvent/);
  });
});
