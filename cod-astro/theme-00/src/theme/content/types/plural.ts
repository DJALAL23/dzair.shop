/**
 * A plural message: one flat key per CLDR form, chosen by `formatMessage`
 * (@wocart/theme) from a `count`. `_other` is always there; the other forms
 * are present exactly as each language needs them (Arabic six, French three,
 * English two), which `packs.test.ts` checks against the language's own rules.
 */
import type { PluralCategory } from "@wocart/theme";

export type Plural<K extends string> = { [P in `${K}_other`]: string } & {
  [P in `${K}_${Exclude<PluralCategory, "other">}`]?: string;
};
