import type { StoreLocale } from "../i18n/locales";
import type { Condition, RuleAction, RuleMode } from "./conditions";

export const TEMPLATE_KEYS = ["recommended", "under_attack", "empty"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATE: TemplateKey = "recommended";

const CONDITIONS_OF = {
  good_customer: [{ key: "delivered_before", op: "at_least", value: 1 }],
  same_phone: [{ key: "phone_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }],
  same_ip: [{ key: "ip_orders", op: "at_least_in_window", value: { count: 20, windowHours: 24 } }],
  burst: [{ key: "ip_burst", op: "is_true", value: null }],
  same_device: [{ key: "device_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }],
  many_numbers: [{ key: "device_phones", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }],
  fast_fill: [{ key: "fill_seconds", op: "at_most", value: 5 }],
  returner: [
    { key: "returned_before", op: "at_least", value: 2 },
    { key: "delivered_before", op: "at_most", value: 0 },
  ],
} as const satisfies Record<string, readonly Condition[]>;

export type TemplateRuleKey = keyof typeof CONDITIONS_OF;

const NAMES: Readonly<Record<StoreLocale, Record<TemplateRuleKey, string>>> = {
  en: {
    good_customer: "Customers who received an order",
    same_phone: "Several orders from one phone",
    same_ip: "Many orders from one network",
    burst: "Sudden burst of orders",
    same_device: "Several orders from one device",
    many_numbers: "Several phone numbers on one device",
    fast_fill: "Form filled in a few seconds",
    returner: "Returned before, never delivered",
  },
  fr: {
    good_customer: "Clients déjà livrés",
    same_phone: "Plusieurs commandes d'un même numéro",
    same_ip: "Beaucoup de commandes d'un même réseau",
    burst: "Afflux soudain de commandes",
    same_device: "Plusieurs commandes d'un même appareil",
    many_numbers: "Plusieurs numéros sur un même appareil",
    fast_fill: "Formulaire rempli en quelques secondes",
    returner: "Retours sans aucune livraison",
  },
  ar: {
    good_customer: "زبائن استلموا طلبًا",
    same_phone: "عدة طلبات من نفس الرقم",
    same_ip: "طلبات كثيرة من نفس الشبكة",
    burst: "تدفق مفاجئ للطلبات",
    same_device: "عدة طلبات من نفس الجهاز",
    many_numbers: "عدة أرقام على نفس الجهاز",
    fast_fill: "تعبئة النموذج في ثوانٍ",
    returner: "مرتجعات دون أي تسليم",
  },
};

export interface TemplateRule {
  key: TemplateRuleKey;
  action: RuleAction;
  mode: RuleMode;
}

export const TEMPLATES: Readonly<Record<TemplateKey, readonly TemplateRule[]>> = {
  recommended: [
    { key: "good_customer", action: "accept", mode: "active" },
    { key: "same_phone", action: "flag", mode: "trial" },
    { key: "same_ip", action: "flag", mode: "trial" },
    { key: "burst", action: "spam", mode: "trial" },
    { key: "same_device", action: "flag", mode: "trial" },
    { key: "many_numbers", action: "flag", mode: "trial" },
    { key: "fast_fill", action: "flag", mode: "trial" },
    { key: "returner", action: "flag", mode: "trial" },
  ],
  under_attack: [
    { key: "good_customer", action: "accept", mode: "active" },
    { key: "same_phone", action: "spam", mode: "active" },
    { key: "same_ip", action: "flag", mode: "active" },
    { key: "burst", action: "spam", mode: "active" },
    { key: "same_device", action: "flag", mode: "active" },
    { key: "many_numbers", action: "spam", mode: "active" },
    { key: "fast_fill", action: "flag", mode: "active" },
    { key: "returner", action: "spam", mode: "active" },
  ],
  empty: [],
};

export const TEMPLATE_RULE_KEYS = Object.keys(CONDITIONS_OF) as TemplateRuleKey[];

export function isTemplateRuleKey(value: unknown): value is TemplateRuleKey {
  return typeof value === "string" && (TEMPLATE_RULE_KEYS as readonly string[]).includes(value);
}

/** A template rule's name, in the language a person reads it in. */
export function templateRuleName(key: TemplateRuleKey, locale: StoreLocale): string {
  return NAMES[locale][key];
}

/** Whether a name is the one a template gave this rule, in any language: the rule was not renamed. */
export function isTemplateName(key: TemplateRuleKey, name: string): boolean {
  return Object.values(NAMES).some((names) => names[key] === name.trim());
}

/** A Template's rules as a person would have written them, named in the store's language. */
export function templateRules(key: TemplateKey, locale: StoreLocale) {
  return TEMPLATES[key].map((rule) => ({ templateRule: rule.key, name: NAMES[locale][rule.key], mode: rule.mode, action: rule.action, conditions: CONDITIONS_OF[rule.key] as readonly Condition[] }));
}
