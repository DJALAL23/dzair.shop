import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const locales = {
  fr: { lang: "fr", dir: "ltr" },
  ar: { lang: "ar", dir: "rtl" },
};

async function walk(dir, locale) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, locale);
    else if (entry.name.endsWith(".html")) await localize(path, locale);
  }
}

async function localize(path, locale) {
  const { lang, dir } = locales[locale];
  const html = await readFile(path, "utf8");
  const next = html.replace(
    /<html lang="en"/,
    `<html lang="${lang}" dir="${dir}"`,
  );
  if (next !== html) await writeFile(path, next);
}

for (const locale of Object.keys(locales)) {
  try {
    await walk(join("dist", locale), locale);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (const file of [join("dist", `${locale}.html`), join("dist", locale, "index.html")]) {
    try {
      await localize(file, locale);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
