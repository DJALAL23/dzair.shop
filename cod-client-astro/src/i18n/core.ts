import type { Dict } from "./dictionaries";

/** Resolve a dot-path ("table.total") inside a nested dictionary. */
export function resolve(dict: Dict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && Object.hasOwn(node as Dict, part)) {
      node = (node as Dict)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

export type MessageValues = Readonly<Record<string, string | number>>;

/** A translator: `t(key)`, or `t(key, values)` for placeholders and plurals. */
export type Translate = (key: string, values?: MessageValues) => string;

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) pluralRulesCache.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules;
}

/** Numbers in messages: the language's grouping, Latin digits (as Algerian business text writes them). */
function numberFormat(locale: string): Intl.NumberFormat {
  let format = numberFormatCache.get(locale);
  if (!format) numberFormatCache.set(locale, (format = new Intl.NumberFormat(locale, { numberingSystem: "latn" })));
  return format;
}

/**
 * The template for `key` with `count` — the same convention as
 * `@codflow/theme`'s `formatMessage`, one flat key per CLDR form: `key_zero`
 * for 0 when present, then the form the language's rules select, then
 * `key_other`, then the plain key.
 */
function template(lookup: (key: string) => string | undefined, key: string, count: number | undefined, locale: string) {
  if (count === undefined) return lookup(key);
  return (
    (count === 0 ? lookup(`${key}_zero`) : undefined) ??
    lookup(`${key}_${pluralRules(locale).select(count)}`) ??
    lookup(`${key}_other`) ??
    lookup(key)
  );
}

/** Fill every `{name}` placeholder; numbers are formatted, unknown names stay visible. */
export function fill(text: string, values: MessageValues, locale: string): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) return placeholder;
    const value = values[name]!;
    return typeof value === "number" ? numberFormat(locale).format(value) : value;
  });
}

/**
 * Translator with en fallback: locale dict → english dict → raw key.
 * Missing keys return the key itself so gaps are visible, never blank UI.
 * With values, `count` picks the plural form and every placeholder is filled.
 */
export function makeT(localeDict: Dict, englishDict: Dict, locale = "en"): Translate {
  return (key, values) => {
    const count = typeof values?.count === "number" ? values.count : undefined;
    // A language's own forms first; English only when the language lacks the message.
    const own = template((k) => resolve(localeDict, k), key, count, locale);
    const text = own ?? template((k) => resolve(englishDict, k), key, count, "en") ?? key;
    return values ? fill(text, values, locale) : text;
  };
}
