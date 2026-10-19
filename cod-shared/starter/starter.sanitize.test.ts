/**
 * The starter's HTML as the real sanitiser sees it. HTMLRewriter runs only in
 * workerd, so `sanitizeRichText` and `toPlainText` are called inside Miniflare
 * (the pattern of legal/templates.sanitize.test.ts): every product
 * description comes out unchanged, exactly what the product editor would
 * save, and `legalPlainText` — the seed's plain text, computed without
 * HTMLRewriter — is `toPlainText`'s for every legal page, with a store name
 * that needs escaping.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORE_LOCALES } from "../i18n/locales";
import { LEGAL_PAGE_KINDS, PAGE_LOCALES } from "../legal/kinds";
import { legalFactsFrom, renderLegalTemplate } from "../legal/render";
import { legalPagesSql, legalPlainText } from "../legal/seed";
import { escapeHtml } from "../legal/serialize";
import { STARTER_PRODUCTS } from "./content";

const here = dirname(fileURLToPath(import.meta.url));

const WORKER = `
import { sanitizeRichText, toPlainText } from "./rich-text.mjs";
export default {
  async fetch(request) {
    const { fn, arg } = await request.json();
    const result = fn === "sanitizeRichText" ? await sanitizeRichText(arg) : await toPlainText(arg);
    return Response.json(result);
  },
};
`;

let mf: Miniflare | undefined;

beforeAll(async () => {
  const lib = await transform(readFileSync(join(here, "../lib/rich-text.ts"), "utf8"), { loader: "ts", format: "esm" });
  mf = new Miniflare({
    modules: [
      { type: "ESModule", path: "index.mjs", contents: WORKER },
      { type: "ESModule", path: "rich-text.mjs", contents: lib.code },
    ],
  });
});

afterAll(async () => {
  await mf?.dispose();
});

async function call<T>(fn: "sanitizeRichText" | "toPlainText", arg: string): Promise<T> {
  const worker = await mf!.getWorker();
  const res = await worker.fetch("http://starter-sanitize.test/", { method: "POST", body: JSON.stringify({ fn, arg }) });
  return (await res.json()) as T;
}

const DESCRIPTIONS = STARTER_PRODUCTS.flatMap((product) => STORE_LOCALES.map((locale) => [product.key, locale, product.description[locale]] as const));

describe("starter product descriptions", () => {
  it.each(DESCRIPTIONS)("%s / %s passes the sanitiser unchanged", async (_key, _locale, html) => {
    const { html: sanitised, removed } = await call<{ html: string; removed: unknown[] }>("sanitizeRichText", html);
    expect(removed).toEqual([]);
    expect(sanitised).toBe(html);
  });
});

const NAME = `Chez "Amel" & Fils <DZ>`;
const PAGES = PAGE_LOCALES.flatMap((locale) => LEGAL_PAGE_KINDS.map((kind) => [locale, kind] as const));

describe("legal pages seeded as SQL", () => {
  it.each(PAGES)("%s / %s stores toPlainText's plain text", async (locale, kind) => {
    const html = renderLegalTemplate(kind, locale, legalFactsFrom({ name: NAME }, null)).bodyHtml;
    expect(legalPlainText(html)).toBe(await call<string>("toPlainText", html));
  });

  it("prints the name escaped in the pages that name the store", () => {
    const named = PAGES.filter(([locale, kind]) => renderLegalTemplate(kind, locale, legalFactsFrom({ name: NAME }, null)).bodyHtml.includes(escapeHtml(NAME)));
    expect(named.map(([, kind]) => kind)).toEqual(expect.arrayContaining(["terms", "privacy"]));
  });

  it.each(PAGES)("%s / %s stores the body the template renders for the store", (locale, kind) => {
    const rendered = renderLegalTemplate(kind, locale, legalFactsFrom({ name: NAME }, null));
    const row = legalPagesSql({ id: "store-1", name: NAME }, "2026-10-20T08:00:00.000Z").find(
      (statement) => statement.includes("INTO store_page_translations") && statement.includes(`'sp-store-1-${kind}', '${locale}'`),
    )!;
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    expect(row).toContain(`${quote(rendered.title)}, ${quote(rendered.bodyHtml)}, ${quote(legalPlainText(rendered.bodyHtml))}, NULL, ${quote(rendered.metaDescription)}`);
  });
});
