import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");
const LOCALES = join(ROOT, "locales");

/** Text that is the same in every language: a brand, a keyboard hint, an example. */
const SAME_EVERYWHERE = new Set(["CodFlow", "Ctrl K", "English", "Français", "Alger", "Cloudflare Turnstile", "Français (WhatsApp)", "English (WhatsApp)"]);

function tsxFiles(directory: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("tiptap-")) tsxFiles(path, acc);
    } else if (extname(entry.name) === ".tsx" && !entry.name.includes(".test.")) acc.push(path);
  }
  return acc;
}

/** The line with everything that is not shown to a person taken out. */
function visibleParts(line: string): string {
  return line
    .replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{"[^"]*"\})/g, "")
    .replace(/\b(?:href|key|dir|lang|type|role|id|name|htmlFor|src|accept|inputMode|autoComplete|variant|size|tone|side|align|rel|target|method|value|data-[\w-]+)=(?:"[^"]*"|\{[^{}]*\})/g, "")
    .replace(/(?:case|===|!==|==|!=)\s*"[^"]*"/g, "")
    .replace(/\b(?:useT|t|common|settings|auth|navigation|notify\.\w+)\(\s*(?:"[^"]*"|`[^`]*`)/g, "");
}

const WORDS = /[A-Za-z]{2,}/g;
/** Text a person reads: starts with a capital, then only sentence characters. */
const SENTENCE = /^[A-Z][A-Za-z0-9 .,'\u2019…·()/&-]+$/;
const isSentence = (text: string) => SENTENCE.test(text) && (text.match(WORDS) ?? []).length >= 2 && text.includes(" ");
const ATTRIBUTE_TEXT = /\b(?:label|placeholder|title|aria-label|alt|description|hint|help|confirmLabel|cancelLabel|tooltip|subtitle)="([^"{}]*[A-Za-z]{3,}[^"{}]*)"/g;
const PHRASE_LITERAL = /"([A-Z][A-Za-z]+(?:[ '’/&,.()\-…·][A-Za-z0-9(){}…·\-/&'.,]*){0,8}…?)"/g;
const JSX_TEXT = /([>)])([^<>\n]*)</g;

function hardcodedText(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(SRC)) {
    readFileSync(file, "utf8").split("\n").forEach((raw, index) => {
      if (/^\s*(import |export type |type |interface |\/\/|\*|\/\*)/.test(raw)) return;
      const line = visibleParts(raw);
      const where = `${relative(SRC, file)}:${index + 1}`;
      for (const m of line.matchAll(ATTRIBUTE_TEXT)) {
        const text = m[1].trim();
        if (!SAME_EVERYWHERE.has(text) && (text.includes(" ") || /^[A-Z][a-z]{3,}$/.test(text))) found.push(`${where}  ${text}`);
      }
      for (const m of line.matchAll(PHRASE_LITERAL)) {
        const text = m[1];
        if (SAME_EVERYWHERE.has(text) || /Promise|Record<|void|=>|Array</.test(text)) continue;
        if (isSentence(text) || text.endsWith("…")) found.push(`${where}  ${text}`);
      }
      for (const m of line.matchAll(JSX_TEXT)) {
        const text = m[2].replace(/\{[^{}]*\}/g, "").trim();
        if (isSentence(text) && !SAME_EVERYWHERE.has(text)) found.push(`${where}  ${m[2].trim()}`);
      }
    });
  }
  return [...new Set(found)];
}

function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  } else if (node != null) out[prefix] = String(node);
  return out;
}

describe("text in code", () => {
  it("never types a sentence a person reads straight into a component: it goes through t(key)", () => {
    expect(hardcodedText()).toEqual([]);
  });
});

describe("translations", () => {
  it("never leave a sentence in French or Arabic that is still the English one", () => {
    const untranslated: string[] = [];
    for (const file of readdirSync(join(LOCALES, "en")).filter((name) => name.endsWith(".json"))) {
      const en = flatten(JSON.parse(readFileSync(join(LOCALES, "en", file), "utf8")));
      for (const lang of ["fr", "ar"] as const) {
        const other = flatten(JSON.parse(readFileSync(join(LOCALES, lang, file), "utf8")));
        for (const [key, value] of Object.entries(en)) {
          const words = (value.replace(/\{[^{}]*\}/g, "").match(WORDS) ?? []).length;
          if (other[key] === value && words >= 3 && value.includes(" ") && !value.includes("@") && !SAME_EVERYWHERE.has(value)) untranslated.push(`${lang}:${file}:${key}  ${value}`);
        }
      }
    }
    expect(untranslated).toEqual([]);
  });
});
