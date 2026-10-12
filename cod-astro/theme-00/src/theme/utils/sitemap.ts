/**
 * The storefront's sitemap, in every published language (ADR 0005, phase D) —
 * Google's multilingual format: one `<url>` per page per language, each
 * listing all of that page's language versions and `x-default`.
 */
import { alternateLinks, localizeHref, type LocaleRouting } from "@codflow/storefront";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `paths` are unprefixed page paths (`/products/phone`); `origin` makes them absolute. */
export function sitemapXml(paths: readonly string[], routing: LocaleRouting, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const multilingual = routing.published.length > 1;
  const urls = [...new Set(paths)].flatMap((path) => {
    const alternates = multilingual
      ? alternateLinks(path, routing, base)
          .map((link) => `    <xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${escapeXml(link.href)}"/>`)
          .join("\n")
      : "";
    return routing.published.map((locale) =>
      [
        "  <url>",
        `    <loc>${escapeXml(`${base}${localizeHref(path, locale, routing)}`)}</loc>`,
        ...(alternates ? [alternates] : []),
        "  </url>",
      ].join("\n"),
    );
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
