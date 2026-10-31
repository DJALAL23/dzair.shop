/**
 * The page-document **surface key** — the single declaration of the format a
 * surface name must have (Phase 6: `cod-sdk/theme-sdk/20`).
 *
 * A surface is the *address* of a composed page: `home`, `product`, …;
 * `area:<key>` is an area's document (a header, a footer), and `page:<slug>`
 * and `lp:<slug>` are the reserved conventions. Three consumers read this
 * constant — cod-server's `GET /store/page-documents/{surface}` route, the
 * seed script in `cod-server/scripts`, and (mirrored, with a parity guard in
 * `scripts/check-platform-parity.mjs`) `@wocart/theme`'s page-data envelope
 * check.
 *
 * It lives in its own module, with no imports, so a caller that only needs to
 * check a surface name does not pull the D1 client and the whole schema in
 * behind it.
 */
export const PAGE_DOCUMENT_SURFACE_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/** The prefix of a landing page's own document: `lp:<landing page id>` (ADR 0022), mirrored by `@wocart/theme`'s `landingSurface`. */
export const LANDING_DOCUMENT_PREFIX = "lp:";

/** The surface a landing page's own document is stored under, by the page's id — which stays when its slug changes. */
export function landingDocumentSurface(landingPageId: string): string {
  return `${LANDING_DOCUMENT_PREFIX}${landingPageId}`;
}
