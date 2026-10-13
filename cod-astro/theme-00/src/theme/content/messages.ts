/**
 * The theme's ONE message binding — Shopify's `t` filter for this theme.
 *
 * Every shopper-facing string with a placeholder or a count goes through
 * `message`: `formatMessage` from @wocart/theme picks the plural form the
 * language's CLDR rules select and fills every `{placeholder}`, and numbers
 * are written with this theme's digits (the same locale as money, so a count
 * and a price on one line never mix digit systems).
 *
 * Browser-safe: scripts receive a message as `data-*={messageData(...)}` and
 * format it with `embeddedMessage`, in the page's `<html lang>`.
 */
import { formatMessage, messageForms, type MessageValues } from "@wocart/theme";
import { MONEY_LOCALE } from "@/theme/utils/money";

const numbers = new Intl.NumberFormat(MONEY_LOCALE);
const formatNumber = (value: number) => numbers.format(value);

type Pack = Readonly<Record<string, string | undefined>>;

const strings = (pack: Pack): Record<string, string> =>
  Object.fromEntries(Object.entries(pack).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

/** One message from a pack (or a pick of it), in `locale`. */
export function message(pack: Pack, key: string, values: MessageValues, locale: string): string {
  return formatMessage(strings(pack), key, values, { locale, formatNumber });
}

/** A message's forms for a browser script, as a `data-*` attribute value. */
export function messageData(pack: Pack, key: string): string {
  return JSON.stringify(messageForms(strings(pack), key));
}

/** In a browser script: format a message embedded with `messageData`, in the page's language. */
export function embeddedMessage(data: string | undefined, key: string, values: MessageValues): string {
  let forms: Record<string, string> = {};
  try {
    forms = data ? (JSON.parse(data) as Record<string, string>) : {};
  } catch {
    forms = {};
  }
  return message(forms, key, values, document.documentElement.lang || "ar");
}

/** In a browser script: fill a plain template carried as markup, in the page's language. */
export function embeddedTemplate(template: string, values: MessageValues): string {
  return message({ template }, "template", values, document.documentElement.lang || "ar");
}

/** Every pack key of one plural message, for a copy pick (`pickCopy`). */
export function pluralKeys<const K extends string>(key: K) {
  return [`${key}_zero`, `${key}_one`, `${key}_two`, `${key}_few`, `${key}_many`, `${key}_other`] as const;
}
