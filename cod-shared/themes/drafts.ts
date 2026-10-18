/**
 * Theme drafts and publications (ADR 0010, migration 0054): the vocabulary the
 * schema and its writer share. CodFlow Cloud's editor writes these tables;
 * this repository declares them and reads them only for the image keys they
 * hold.
 *
 * A draft part is a whole value at the grain of the live tables:
 * - `document`, keyed by surface: the page document, or `null` for the
 *   theme's default;
 * - `settings`, keyed by `""`: the settings object;
 * - `content`, keyed by language: that language's edit map.
 *
 * A publication stores the theme's whole live state as `ThemePart[]`.
 */
export const THEME_DRAFT_PART_KINDS = ["document", "settings", "content"] as const;

export type ThemeDraftPartKind = (typeof THEME_DRAFT_PART_KINDS)[number];

/** One part of a theme's state, as a draft row holds it and a publication lists it. */
export interface ThemePart {
  kind: ThemeDraftPartKind;
  key: string;
  value: Record<string, unknown> | null;
}

/** How many publications the database keeps per store and theme (trigger `theme_publications_keep_newest`). */
export const THEME_PUBLICATIONS_KEPT = 50;

/**
 * What the database answers a draft write whose revision is not the one the
 * writer saw + 1 (trigger `theme_drafts_revision_moves_by_one`): another
 * write came first, and the whole batch is rolled back.
 */
export const THEME_DRAFT_CHANGED = "THEME_DRAFT_CHANGED";
