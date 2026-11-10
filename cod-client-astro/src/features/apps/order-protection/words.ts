import { useLocale, useT } from "@/i18n/react";
import type { Locale } from "@/i18n/config";
import type { RuleMatch } from "../../../../../cod-shared/order-screening/rules";
import { templateRuleName, type TemplateRuleKey } from "../../../../../cod-shared/order-screening/templates";

/** A rule's name as the person reading it reads it: a template rule the merchant never renamed is shown in their language. */
export function ruleName(rule: { name: string; templateRule?: TemplateRuleKey | null }, locale: Locale): string {
  return rule.templateRule ? templateRuleName(rule.templateRule, locale) : rule.name;
}

/** "A, B and C" in the reader's language. */
export function listOf(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** "A, B or C" in the reader's language. */
export function eitherOf(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { style: "long", type: "disjunction" }).format(items);
}

export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** ISO 3166 countries, plus Kosovo (XK), which Cloudflare reports. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT " +
  "JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI " +
  "NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK " +
  "TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

/** What a match is called on screen: the Block List, a template rule in the reader's language, or the merchant's own name. */
export function useMatchName(): (match: RuleMatch) => string {
  const t = useT("apps");
  const locale = useLocale();
  return (match) => {
    if (match.blockList) return t(`order_protection.block_list_match.${match.blockList}`);
    return ruleName({ name: match.name, templateRule: match.template }, locale);
  };
}

/** The match that decided an order's outcome comes first; the others only matched alongside it. */
export function decidingFirst(matches: readonly RuleMatch[], outcome: "spam" | "flag"): { deciding: RuleMatch[]; also: RuleMatch[] } {
  const active = matches.filter((match) => match.mode === "active");
  const deciding = active.filter((match) => match.action === outcome);
  return { deciding, also: active.filter((match) => !deciding.includes(match)) };
}
