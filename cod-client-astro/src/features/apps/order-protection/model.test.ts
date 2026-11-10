import { describe, expect, it } from "vitest";
import { CONDITION_KEYS, CONDITIONS, type ConditionKey } from "../../../../../cod-shared/order-screening/conditions";
import { templateRules } from "../../../../../cod-shared/order-screening/templates";
import { CONDITION_GROUPS, blankCondition, formFromCondition, operatorsOf, rescueErrorKey, ruleFromForm, ruleIssueKey, valueInputOf, wilayaOptions, withOperator, type ConditionForm, type RuleForm } from "./model";

const rule = (conditions: ConditionForm[], extra: Partial<RuleForm> = {}): RuleForm => ({ name: "R", mode: "trial", action: "flag", conditions, ...extra });
const saved = (form: ConditionForm) => {
  const parsed = ruleFromForm(rule([form]));
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.rule.conditions[0];
};
const label = (_key: ConditionKey, value: string | number) => `label-${value}`;

describe("the form of a Condition", () => {
  it("offers every Condition once, in its group", () => {
    expect(CONDITION_GROUPS.flatMap((group) => group.keys).sort()).toEqual([...CONDITION_KEYS].sort());
    for (const { group, keys } of CONDITION_GROUPS) for (const key of keys) expect(CONDITIONS[key].group).toBe(group);
  });

  it("picks the input each operator needs", () => {
    expect(valueInputOf("phone_orders", "at_least_in_window")).toBe("window");
    expect(valueInputOf("pieces", "at_least")).toBe("number");
    expect(valueInputOf("ip_burst", "is_true")).toBe("none");
    expect(valueInputOf("phone", "on_block_list")).toBe("none");
    expect(valueInputOf("phone", "one_of")).toBe("text");
    expect(valueInputOf("wilaya", "not_one_of")).toBe("wilaya");
    expect(valueInputOf("product", "one_of")).toBe("product");
    expect(valueInputOf("delivery_type", "one_of")).toBe("options");
    expect(valueInputOf("app_source", "one_of")).toBe("options");
    expect(valueInputOf("visit_source", "one_of")).toBe("options");
  });

  it("starts valid where it can, on the first operator", () => {
    expect(saved(blankCondition("phone_orders", "u"))).toEqual({ key: "phone_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } });
    expect(saved(blankCondition("pieces", "u"))).toEqual({ key: "pieces", op: "at_least", value: 1 });
  });

  it("never offers the Block List, which applies by itself, except to a rule that already uses it", () => {
    expect(blankCondition("phone", "u").op).toBe("one_of");
    expect(blankCondition("ip", "u").op).toBe("one_of");
    expect(operatorsOf("phone")).toEqual(["one_of", "starts_with"]);
    expect(operatorsOf("phone", "on_block_list")).toEqual(["on_block_list", "one_of", "starts_with"]);
  });

  it("sends picked countries as their codes", () => {
    expect(valueInputOf("network_country", "one_of")).toBe("country");
    expect(saved({ ...blankCondition("network_country", "u"), picked: [{ id: "DZ", label: "Algeria" }] }).value).toEqual(["DZ"]);
  });

  it("splits lists on new lines and both commas", () => {
    expect(saved({ ...blankCondition("name", "u"), text: "test, faux\nfake،  spam " }).value).toEqual(["test", "faux", "fake", "spam"]);
  });

  it("sends picked wilayas as numbers and products as ids", () => {
    expect(saved({ ...blankCondition("wilaya", "u"), picked: [{ id: "16", label: "Alger" }] }).value).toEqual([16]);
    expect(saved({ ...blankCondition("product", "u"), picked: [{ id: "p1", label: "Robe" }] }).value).toEqual(["p1"]);
  });

  it("refuses an empty number instead of reading it as zero", () => {
    expect(ruleFromForm(rule([{ ...blankCondition("pieces", "u"), op: "at_most", number: " " }]))).toMatchObject({ ok: false, code: "INVALID_VALUE" });
  });

  it("keeps what is typed when the new operator takes the same input, and starts over when not", () => {
    const form = { ...blankCondition("name", "u"), text: "test" };
    expect(withOperator({ ...form, op: "contains_any" }, "contains_any").text).toBe("test");
    const number = { ...blankCondition("pieces", "u"), number: "7" };
    expect(withOperator(number, "at_most")).toMatchObject({ op: "at_most", number: "7" });
    expect(withOperator({ ...blankCondition("name", "u"), text: "test", op: "contains_any" }, "shorter_than")).toMatchObject({ op: "shorter_than", text: "", uid: "u" });
  });
});

describe("back and forth", () => {
  it.each(["en", "fr", "ar"] as const)("every Template rule in %s survives the form unchanged", (locale) => {
    for (const draft of [...templateRules("recommended", locale), ...templateRules("under_attack", locale)]) {
      const forms = draft.conditions.map((condition, index) => formFromCondition(condition, String(index), label));
      expect(ruleFromForm(rule(forms, { name: draft.name, mode: draft.mode, action: draft.action }))).toEqual({ ok: true, rule: { name: draft.name, mode: draft.mode, action: draft.action, conditions: draft.conditions } });
    }
  });

  it.each([
    { key: "phone_orders", op: "at_least_in_window", value: { count: 5, windowHours: 72 } },
    { key: "name", op: "contains_any", value: ["test", "faux"] },
    { key: "pieces", op: "at_most", value: 4 },
    { key: "wilaya", op: "not_one_of", value: [16, 31] },
    { key: "product", op: "one_of", value: ["p1"] },
    { key: "delivery_type", op: "one_of", value: ["stop_desk"] },
    { key: "app_source", op: "one_of", value: ["facebook", "tiktok"] },
    { key: "visit_source", op: "one_of", value: ["meta"] },
    { key: "network_country", op: "not_one_of", value: ["DZ"] },
    { key: "fill_seconds", op: "at_most", value: 5 },
    { key: "device_orders", op: "at_least_in_window", value: { count: 3, windowHours: 24 } },
    { key: "device_phones", op: "at_least_in_window", value: { count: 2, windowHours: 1 } },
    { key: "ip_burst", op: "is_true", value: null },
  ] as const)("$key survives the form unchanged", (condition) => {
    expect(saved(formFromCondition(condition as never, "u", label))).toEqual(condition);
  });

  it("names what was picked", () => {
    expect(formFromCondition({ key: "wilaya", op: "one_of", value: [16] }, "u", label).picked).toEqual([{ id: "16", label: "label-16" }]);
  });
});

describe("what the merchant is told", () => {
  it.each([
    ["INVALID_NAME", "rule_error.name"],
    ["NO_CONDITIONS", "rule_error.no_conditions"],
    ["TOO_MANY_CONDITIONS", "rule_error.too_many_conditions"],
    ["INVALID_VALUE", "rule_error.value"],
    ["INVALID_ACTION", "rule_error.action"],
    ["UNKNOWN_KEY", "rule_error.unknown"],
  ] as const)("%s reads %s", (code, key) => {
    expect(ruleIssueKey(code)).toBe(key);
  });

  it.each([
    ["INSUFFICIENT_STOCK", "spam.rescue_no_stock"],
    ["SPAM_ORDER_ALREADY_RESCUED", "spam.rescue_already"],
    ["DELIVERY_NOT_AVAILABLE", "spam.rescue_no_delivery"],
    ["COUPON_NOT_APPLICABLE", "spam.rescue_coupon"],
    ["PRODUCT_NOT_FOUND", "spam.rescue_unavailable"],
    ["VARIANT_NOT_FOUND", "spam.rescue_unavailable"],
    ["REQUIRED_FIELD_MISSING", "spam.rescue_no_sku"],
    ["OTHER", "spam.rescue_failed"],
  ])("a refused Rescue with %s reads %s", (code, key) => {
    expect(rescueErrorKey({ code })).toBe(key);
  });

  it("falls back on anything else", () => {
    expect(rescueErrorKey(new Error("x"))).toBe("spam.rescue_failed");
  });

  it("names wilayas in the merchant's language", () => {
    expect(wilayaOptions("fr")[15]).toEqual({ id: "16", label: "16 · Alger" });
    expect(wilayaOptions("ar")[15].label).toMatch(/^16 · [؀-ۿ]/);
    expect(wilayaOptions("fr")).toHaveLength(69);
  });
});
