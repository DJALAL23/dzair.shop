/**
 * The four legal pages as SQL — what a store's setup runs, where the dashboard
 * runs `seedStorePages` (queries/store-pages.ts): the same templates, the
 * same slugs and order, published and in the footer, in every page language.
 *
 * The templates come out of the sanitiser byte for byte
 * (templates.sanitize.test.ts), so their HTML is stored as rendered; the
 * plain text is `toPlainText`'s, computed without HTMLRewriter so this runs
 * anywhere (starter.sanitize.test.ts proves the two agree).
 *
 * A page is created only for a kind the store has none of (the unique index
 * `idx_store_pages_kind`), and its translations only in the run that created
 * it: re-running never touches a page the merchant has, nor brings back one
 * they changed.
 */
import { BLOCK_TAGS, decodeEntities } from "../lib/rich-text";
import { LEGAL_PAGE_DEFAULTS, LEGAL_PAGE_KINDS, PAGE_LOCALES, TEMPLATE_VERSION } from "./kinds";
import { legalFactsFrom, renderLegalTemplate } from "./render";
import { escapeHtml } from "./serialize";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** `toPlainText` of the sanitiser, for markup the template serializer writes: blocks spaced, tags dropped, entities decoded. */
export function legalPlainText(html: string): string {
  const spaced = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_tag, _close: string, name: string) => (BLOCK_TAGS.has(name.toLowerCase()) ? " " : ""));
  return decodeEntities(spaced).replace(/\s+/g, " ").trim();
}

/**
 * The statements that give a store its four legal pages. `name` is the
 * store's name as the templates print it: as text in titles and plain text,
 * escaped in HTML — or, for SQL made ahead of time, a placeholder for each.
 */
export function legalPagesSql(store: { id: string; name: string; nameHtml?: string }, now: string): string[] {
  const token = "\u0000STORE\u0000";
  const facts = legalFactsFrom({ name: token }, null);
  const asText = (value: string) => value.split(token).join(store.name);
  const asHtml = (value: string) => value.split(token).join(store.nameHtml ?? escapeHtml(store.name));
  const statements: string[] = [];
  for (const kind of LEGAL_PAGE_KINDS) {
    const pageId = `sp-${store.id}-${kind}`;
    const defaults = LEGAL_PAGE_DEFAULTS[kind];
    statements.push(
      `INSERT OR IGNORE INTO store_pages (id, store_id, kind, slug, status, show_in_footer, position, template_version, created_at, updated_at) SELECT ${q(pageId)}, ${q(store.id)}, ${q(kind)}, ${q(defaults.slug)}, 'published', 1, ${defaults.position}, ${TEMPLATE_VERSION}, ${q(now)}, ${q(now)}`,
    );
    for (const locale of PAGE_LOCALES) {
      const rendered = renderLegalTemplate(kind, locale, facts);
      statements.push(
        `INSERT OR IGNORE INTO store_page_translations (page_id, locale, title, body_html, body_plain, meta_title, meta_description, source, updated_at) SELECT ${q(pageId)}, ${q(locale)}, ${q(asText(rendered.title))}, ${q(asHtml(rendered.bodyHtml))}, ${q(asText(legalPlainText(rendered.bodyHtml)))}, NULL, ${q(asText(rendered.metaDescription))}, 'template', ${q(now)} WHERE (SELECT created_at FROM store_pages WHERE id = ${q(pageId)}) = ${q(now)}`,
      );
    }
  }
  return statements;
}
