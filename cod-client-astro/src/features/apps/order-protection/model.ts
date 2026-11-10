import type { PickerOption } from "@/components/ui";
import { ERROR_CODES } from "../../../../../cod-shared/errors/codes";
import { CONDITION_KEYS, CONDITIONS, valueShape, type Condition, type ConditionKey, type ListValue, type Operator, type WindowValue } from "../../../../../cod-shared/order-screening/conditions";
import { parseRule, type ParsedRule, type RuleIssueCode } from "../../../../../cod-shared/order-screening/rules";
import { WILAYAS } from "../../../../../cod-shared/places";

export type ValueInput = "none" | "number" | "window" | "text" | "wilaya" | "country" | "product" | "options";

export function valueInputOf(key: ConditionKey, op: Operator): ValueInput {
  const shape = valueShape(op);
  if (shape !== "list") return shape;
  if (key === "wilaya") return "wilaya";
  if (key === "network_country") return "country";
  if (key === "product") return "product";
  if (CONDITIONS[key].options) return "options";
  return "text";
}

export interface ConditionForm {
  uid: string;
  key: ConditionKey;
  op: Operator;
  count: string;
  windowHours: number;
  number: string;
  text: string;
  picked: PickerOption[];
}

export const CONDITION_GROUPS = (["who", "typed", "history"] as const).map((group) => ({ group, keys: CONDITION_KEYS.filter((key) => CONDITIONS[key].group === group) }));

const DEFAULT_WINDOW_HOURS = 24;

/** The comparisons offered for a condition. The Block List always applies by itself, so "is on the Block List" is offered only to a rule that already uses it. */
export function operatorsOf(key: ConditionKey, current?: Operator): readonly Operator[] {
  return CONDITIONS[key].operators.filter((op) => op !== "on_block_list" || op === current);
}

export function blankCondition(key: ConditionKey, uid: string): ConditionForm {
  return { uid, key, op: operatorsOf(key)[0], count: "3", windowHours: DEFAULT_WINDOW_HOURS, number: key === "fill_seconds" ? "5" : "1", text: "", picked: [] };
}

export function withOperator(form: ConditionForm, op: Operator): ConditionForm {
  return valueInputOf(form.key, op) === valueInputOf(form.key, form.op) ? { ...form, op } : { ...blankCondition(form.key, form.uid), op };
}

const asNumber = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));
const textValues = (raw: string) => raw.split(/[\n,،]/).map((value) => value.trim()).filter(Boolean);

function valueToSave(form: ConditionForm): unknown {
  switch (valueInputOf(form.key, form.op)) {
    case "none":
      return null;
    case "number":
      return asNumber(form.number);
    case "window":
      return { count: asNumber(form.count), windowHours: form.windowHours };
    case "text":
      return textValues(form.text);
    case "wilaya":
      return form.picked.map((option) => Number(option.id));
    case "country":
    case "product":
    case "options":
      return form.picked.map((option) => option.id);
  }
}

export interface RuleForm {
  name: string;
  mode: string;
  action: string;
  conditions: ConditionForm[];
}

/** The form as the one validator the server also uses reads it. */
export function ruleFromForm(form: RuleForm): ParsedRule {
  return parseRule({ name: form.name, mode: form.mode, action: form.action, conditions: form.conditions.map((condition) => ({ key: condition.key, op: condition.op, value: valueToSave(condition) })) });
}

export function wilayaOptions(locale: string): PickerOption[] {
  return WILAYAS.map((wilaya) => ({ id: String(wilaya.id), label: `${wilaya.id} · ${locale === "ar" ? wilaya.nameAr : wilaya.name}` }));
}

export function formFromCondition(condition: Condition, uid: string, label: (key: ConditionKey, value: string | number) => string): ConditionForm {
  const form = { ...blankCondition(condition.key, uid), op: condition.op };
  switch (valueInputOf(condition.key, condition.op)) {
    case "none":
      return form;
    case "number":
      return { ...form, number: String(condition.value) };
    case "window": {
      const value = condition.value as WindowValue;
      return { ...form, count: String(value.count), windowHours: value.windowHours };
    }
    case "text":
      return { ...form, text: (condition.value as ListValue).join("\n") };
    default:
      return { ...form, picked: (condition.value as ListValue).map((value) => ({ id: String(value), label: label(condition.key, value) })) };
  }
}

/** The dictionary key that says why a rule cannot be saved. */
export function ruleIssueKey(code: RuleIssueCode): string {
  if (code === "INVALID_NAME") return "rule_error.name";
  if (code === "NO_CONDITIONS") return "rule_error.no_conditions";
  if (code === "TOO_MANY_CONDITIONS") return "rule_error.too_many_conditions";
  if (code === "INVALID_VALUE") return "rule_error.value";
  if (code === "INVALID_ACTION") return "rule_error.action";
  return "rule_error.unknown";
}

export function rescueErrorKey(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === ERROR_CODES.INSUFFICIENT_STOCK) return "spam.rescue_no_stock";
  if (code === ERROR_CODES.SPAM_ORDER_ALREADY_RESCUED) return "spam.rescue_already";
  if (code === ERROR_CODES.DELIVERY_NOT_AVAILABLE) return "spam.rescue_no_delivery";
  if (code === ERROR_CODES.COUPON_NOT_APPLICABLE) return "spam.rescue_coupon";
  if (code === ERROR_CODES.PRODUCT_NOT_FOUND || code === ERROR_CODES.VARIANT_NOT_FOUND) return "spam.rescue_unavailable";
  if (code === ERROR_CODES.REQUIRED_FIELD_MISSING) return "spam.rescue_no_sku";
  return "spam.rescue_failed";
}
