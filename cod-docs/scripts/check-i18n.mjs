import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = path.join(root, "pages");
const locales = ["en", "fr", "ar"];

const problems = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function relative(file) {
  return path.relative(pagesDir, file).split(path.sep).join("/");
}

function localeOf(relativePath) {
  if (relativePath.startsWith("fr/")) return "fr";
  if (relativePath.startsWith("ar/")) return "ar";
  return "en";
}

function stripLocale(relativePath) {
  return relativePath.replace(/^(fr|ar)\//, "");
}

function headings(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  let inFence = false;
  const found = [];
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,3} /.test(line)) found.push(line.trim());
  }
  return found;
}

const files = walk(pagesDir).filter((file) => /\.mdx?$/.test(file) && !file.includes(`${path.sep}reference${path.sep}`));
const byLocale = { en: new Map(), fr: new Map(), ar: new Map() };
const navigation = readFileSync(path.join(root, "src/i18n/navigation.ts"), "utf8");

function slugsOf(constName) {
  const start = navigation.indexOf(`const ${constName}`);
  if (start === -1) return [];
  const end = navigation.indexOf("\n];", start);
  const block = navigation.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/slug: "([^"]*)"/g)].map((match) => match[1]);
}

const englishOnly = new Set(slugsOf("englishOnlyGroups").map((slug) => slug.replace(/^\//, "")));

const englishOnlySections = [...navigation.matchAll(/englishOnlySections = \[([^\]]*)\]/g)]
  .flatMap((match) => [...match[1].matchAll(/"\/([^"]+)"/g)].map((section) => section[1]));

function isEnglishOnly(slug) {
  return englishOnly.has(slug) || englishOnlySections.some((section) => slug === section || slug.startsWith(`${section}/`));
}

const englishOnlyPages = new Set();

for (const file of files) {
  const rel = relative(file);
  const slug = stripLocale(rel).replace(/\.mdx?$/, "");
  if (isEnglishOnly(slug)) {
    if (localeOf(rel) === "en") englishOnlyPages.add(slug);
    else problems.push(`pages/${rel}: a translation of an English-only page; English-only sections have no French or Arabic pages`);
    continue;
  }
  byLocale[localeOf(rel)].set(slug, file);
}

for (const [slug, englishFile] of byLocale.en) {
  const enHeadings = headings(englishFile);
  if (enHeadings.length === 0) problems.push(`pages/${slug}: no headings — is the page empty?`);

  for (const locale of ["fr", "ar"]) {
    const translated = byLocale[locale].get(slug);
    if (translated === undefined) {
      problems.push(`pages/${locale}/${slug}: missing (English page has no ${locale} translation)`);
      continue;
    }
    if (readFileSync(translated, "utf8").trim().length === 0) {
      problems.push(`pages/${locale}/${slug}: empty file`);
      continue;
    }
    const localHeadings = headings(translated);
    if (localHeadings.length !== enHeadings.length) {
      problems.push(
        `pages/${locale}/${slug}: ${localHeadings.length} headings, English has ${enHeadings.length}`,
      );
    }
  }
}

for (const locale of ["fr", "ar"]) {
  for (const slug of byLocale[locale].keys()) {
    if (!byLocale.en.has(slug)) problems.push(`pages/${locale}/${slug}: no English counterpart`);
  }
}

const sections = [
  { base: "", slugs: slugsOf("corePages") },
  { base: "/sdk/storefront", slugs: slugsOf("storefrontGroups") },
  { base: "/sdk/theme", slugs: slugsOf("themeGroups") },
];

const referenced = new Set();

for (const slug of englishOnly) {
  if (!files.some((file) => relative(file).replace(/\.mdx?$/, "") === slug)) {
    problems.push(`src/i18n/navigation.ts: "/${slug}" has no English page (${slug}.mdx)`);
  }
}

for (const { base, slugs } of sections) {
  for (const slug of slugs) {
    if (slug === "") {
      if (base !== "") referenced.add(base.replace(/^\//, ""));
      continue;
    }
    const key = `${base}${slug}`.replace(/^\//, "");
    referenced.add(key);
    if (isEnglishOnly(key)) {
      if (!englishOnlyPages.has(key)) problems.push(`src/i18n/navigation.ts: "${base}${slug}" has no English page (${key}.mdx)`);
      continue;
    }
    for (const locale of locales) {
      const where = locale === "en" ? key : `${locale}/${key}`;
      if (!byLocale[locale].has(key)) {
        problems.push(`src/i18n/navigation.ts: "${base}${slug}" has no ${locale} page (${where}.mdx)`);
      }
    }
  }
}

for (const slug of [...byLocale.en.keys(), ...englishOnlyPages]) {
  if (!referenced.has(slug) && !englishOnly.has(slug)) problems.push(`pages/${slug}: exists but is not listed in src/i18n/navigation.ts`);
}

if (problems.length > 0) {
  console.error(`[docs] ${problems.length} localisation problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[docs] ${byLocale.en.size} pages aligned across ${locales.join(", ")}; every navigation entry has a file.`,
  );
}
