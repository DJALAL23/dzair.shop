import type { StoreLocale } from "../i18n/locales";
import type { Condition, RuleAction, RuleMode } from "./conditions";

export const TEMPLATE_KEYS = ["recommended", "under_attack", "empty"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATE: TemplateKey = "recommended";

const CONDITIONS_OF = {
  blocked_phone: [{ key: "phone", op: "on_block_list", value: null }],
  blocked_ip: [{ key: "ip", op: "on_block_list", value: null }],
  good_customer: [{ key: "delivered_before", op: "at_least", value: 1 }],
  same_phone: [{ key: "phone_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } }],
  same_ip: [{ key: "ip_orders", op: "at_least_in_window", value: { count: 20, windowHours: 24 } }],
  burst: [{ key: "ip_burst", op: "is_true", value: null }],
  returner: [
    { key: "returned_before", op: "at_least", value: 2 },
    { key: "delivered_before", op: "at_most", value: 0 },
  ],
} as const satisfies Record<string, readonly Condition[]>;

export type TemplateRuleKey = keyof typeof CONDITIONS_OF;

const NAMES: Readonly<Record<StoreLocale, Record<TemplateRuleKey, string>>> = {
  en: {
    blocked_phone: "Blocked phone numbers",
    blocked_ip: "Blocked networks",
    good_customer: "Customers who received an order",
    same_phone: "Several orders from one phone",
    same_ip: "Many orders from one network",
    burst: "Sudden burst of orders",
    returner: "Returned before, never delivered",
  },
  fr: {
    blocked_phone: "Numéros bloqués",
    blocked_ip: "Réseaux bloqués",
    good_customer: "Clients déjà livrés",
    same_phone: "Plusieurs commandes d'un même numéro",
    same_ip: "Beaucoup de commandes d'un même réseau",
    burst: "Afflux soudain de commandes",
    returner: "Retours sans aucune livraison",
  },
  ar: {
    blocked_phone: "الأرقام المحظورة",
    blocked_ip: "الشبكات المحظورة",
    good_customer: "زبائن استلموا طلبًا",
    same_phone: "عدة طلبات من نفس الرقم",
    same_ip: "طلبات كثيرة من نفس الشبكة",
    burst: "تدفق مفاجئ للطلبات",
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
    { key: "blocked_phone", action: "spam", mode: "active" },
    { key: "blocked_ip", action: "spam", mode: "active" },
    { key: "good_customer", action: "accept", mode: "active" },
    { key: "same_phone", action: "flag", mode: "trial" },
    { key: "same_ip", action: "flag", mode: "trial" },
    { key: "burst", action: "spam", mode: "trial" },
    { key: "returner", action: "flag", mode: "trial" },
  ],
  under_attack: [
    { key: "blocked_phone", action: "spam", mode: "active" },
    { key: "blocked_ip", action: "spam", mode: "active" },
    { key: "good_customer", action: "accept", mode: "active" },
    { key: "same_phone", action: "spam", mode: "active" },
    { key: "same_ip", action: "flag", mode: "active" },
    { key: "burst", action: "spam", mode: "active" },
    { key: "returner", action: "spam", mode: "active" },
  ],
  empty: [],
};

/** A Template's rules as a person would have written them, named in the store's language. */
export function templateRules(key: TemplateKey, locale: StoreLocale) {
  return TEMPLATES[key].map((rule) => ({ name: NAMES[locale][rule.key], mode: rule.mode, action: rule.action, conditions: CONDITIONS_OF[rule.key] as readonly Condition[] }));
}
