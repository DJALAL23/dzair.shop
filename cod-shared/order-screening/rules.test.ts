import { describe, expect, it } from "vitest";
import { CONDITION_KEYS, CONDITIONS, RULE_LIMITS, conditionHolds, parseCondition, sourceOf, type Condition, type Facts, type RuleAction, type RuleMode } from "./conditions";
import { decide, parseRule, readsOnlyBlockList, readStoredConditions, type Rule } from "./rules";
import { ipKey } from "./signals";
import { DEFAULT_TEMPLATE, isTemplateName, isTemplateRuleKey, TEMPLATE_KEYS, TEMPLATE_RULE_KEYS, TEMPLATES, templateRuleName, templateRules } from "./templates";

const FACTS: Facts = {
  phone: "0551234567",
  ipKey: "41.100.1.1",
  name: "Amel Benali",
  address: "12 Rue Didouche",
  wilayaId: 16,
  productIds: ["p1", "p2"],
  pieces: 3,
  deliveryType: "home",
  windowCounts: { "phone_orders:24": 3, "ip_orders:1": 2 },
  blocked: { phone: false, ip: false },
  history: { delivered: 1, returned: 2 },
  burst: false,
  deviceKey: "d1",
  fillSeconds: 4,
  visitSource: "meta",
  appSource: "instagram",
  networkCountry: "DZ",
};

const parsed = (key: string, op: string, value: unknown): Condition => {
  const result = parseCondition({ key, op, value });
  if (!result.ok) throw new Error(`${key}/${op}: ${result.code}`);
  return result.condition;
};
const holds = (key: string, op: string, value: unknown, facts: Facts = FACTS) => conditionHolds(parsed(key, op, value), facts);

let serial = 0;
const rule = (action: RuleAction, mode: RuleMode, conditions: Condition[]): Rule => ({ id: `r${(serial += 1)}`, name: `Rule ${serial}`, mode, action, conditions });
const yes = parsed("pieces", "at_least", 1);
const no = parsed("pieces", "at_least", 99);
const blockedPhone = parsed("phone", "on_block_list", null);

describe("each Condition on the facts of an attempt", () => {
  it.each([
    ["phone_orders", "at_least_in_window", { count: 3, windowHours: 24 }, true],
    ["phone_orders", "at_least_in_window", { count: 4, windowHours: 24 }, false],
    ["ip_orders", "at_least_in_window", { count: 2, windowHours: 1 }, true],
    ["ip_orders", "at_least_in_window", { count: 3, windowHours: 1 }, false],
    ["fill_seconds", "at_most", 4, true],
    ["fill_seconds", "at_most", 3, false],
    ["network_country", "one_of", ["dz"], true],
    ["network_country", "one_of", ["FR"], false],
    ["network_country", "not_one_of", ["FR"], true],
    ["network_country", "not_one_of", ["DZ"], false],
    ["visit_source", "one_of", ["meta", "google"], true],
    ["visit_source", "one_of", ["tiktok"], false],
    ["app_source", "one_of", ["instagram"], true],
    ["app_source", "one_of", ["browser"], false],
    ["phone", "one_of", ["+213551234567"], true],
    ["phone", "one_of", ["0661234567"], false],
    ["phone", "starts_with", ["055"], true],
    ["phone", "starts_with", ["066"], false],
    ["phone", "starts_with", ["551"], false],
    ["ip", "one_of", ["41.100.1.1"], true],
    ["ip", "one_of", ["41.100.1.2"], false],
    ["name", "contains_any", ["BENALI"], true],
    ["name", "contains_any", ["test"], false],
    ["name", "shorter_than", 12, true],
    ["name", "shorter_than", 11, false],
    ["address", "contains_any", ["rue  didouche"], true],
    ["address", "shorter_than", 3, false],
    ["wilaya", "one_of", [16, 31], true],
    ["wilaya", "one_of", [31], false],
    ["wilaya", "not_one_of", [31], true],
    ["wilaya", "not_one_of", [16], false],
    ["product", "one_of", ["p2"], true],
    ["product", "one_of", ["p9"], false],
    ["pieces", "at_least", 3, true],
    ["pieces", "at_least", 4, false],
    ["pieces", "at_most", 3, true],
    ["pieces", "at_most", 2, false],
    ["delivery_type", "one_of", ["home"], true],
    ["delivery_type", "one_of", ["stop_desk"], false],
    ["delivered_before", "at_least", 1, true],
    ["delivered_before", "at_most", 0, false],
    ["returned_before", "at_least", 2, true],
    ["returned_before", "at_least", 3, false],
  ])("%s %s %j is %s", (key, op, value, expected) => {
    expect(holds(key, op, value)).toBe(expected);
  });

  it("reads the Block List only through its own operator", () => {
    expect(holds("phone", "on_block_list", null, { ...FACTS, blocked: { phone: true, ip: false } })).toBe(true);
    expect(holds("phone", "on_block_list", null, { ...FACTS, blocked: { phone: false, ip: true } })).toBe(false);
    expect(holds("ip", "on_block_list", null, { ...FACTS, blocked: { phone: false, ip: true } })).toBe(true);
    expect(holds("ip", "on_block_list", null, { ...FACTS, blocked: { phone: true, ip: false } })).toBe(false);
  });

  it("holds a burst only when there is one", () => {
    expect(holds("ip_burst", "is_true", null, { ...FACTS, burst: true })).toBe(true);
    expect(holds("ip_burst", "is_true", null)).toBe(false);
  });

  it("does not count a window it was not asked about", () => {
    expect(holds("phone_orders", "at_least_in_window", { count: 1, windowHours: 1 })).toBe(false);
  });

  it("counts letters, not bytes, in Arabic", () => {
    expect(holds("name", "shorter_than", 5, { ...FACTS, name: "أمل" })).toBe(true);
    expect(holds("name", "shorter_than", 3, { ...FACTS, name: "أمل" })).toBe(false);
  });
});

describe("no data never holds", () => {
  const empty: Facts = { phone: "0551234567", name: "A", wilayaId: 16, productIds: [], pieces: 1, deliveryType: "home" };

  it.each([
    ["phone_orders", "at_least_in_window", { count: 1, windowHours: 24 }],
    ["ip_orders", "at_least_in_window", { count: 1, windowHours: 24 }],
    ["device_orders", "at_least_in_window", { count: 1, windowHours: 24 }],
    ["device_phones", "at_least_in_window", { count: 1, windowHours: 24 }],
    ["fill_seconds", "at_most", 100000],
    ["network_country", "one_of", ["DZ"]],
    ["network_country", "not_one_of", ["DZ"]],
    ["visit_source", "one_of", ["meta", "tiktok", "google", "other"]],
    ["app_source", "one_of", ["facebook", "instagram", "tiktok", "browser"]],
    ["ip_burst", "is_true", null],
    ["phone", "on_block_list", null],
    ["ip", "on_block_list", null],
    ["ip", "one_of", ["41.100.1.1"]],
    ["address", "contains_any", ["x"]],
    ["address", "shorter_than", 100],
    ["product", "one_of", ["p1"]],
    ["delivered_before", "at_most", 5],
    ["returned_before", "at_most", 5],
  ])("%s %s", (key, op, value) => {
    expect(holds(key, op, value, empty)).toBe(false);
  });
});

describe("where a Condition's data comes from", () => {
  it.each([
    ["phone_orders", "at_least_in_window", { count: 1, windowHours: 1 }, "attempts"],
    ["ip_orders", "at_least_in_window", { count: 1, windowHours: 1 }, "attempts"],
    ["device_orders", "at_least_in_window", { count: 1, windowHours: 1 }, "attempts"],
    ["device_phones", "at_least_in_window", { count: 1, windowHours: 1 }, "attempts"],
    ["fill_seconds", "at_most", 1, "submission"],
    ["network_country", "one_of", ["DZ"], "submission"],
    ["visit_source", "one_of", ["meta"], "submission"],
    ["app_source", "one_of", ["browser"], "submission"],
    ["ip_burst", "is_true", null, "burst"],
    ["phone", "on_block_list", null, "block_list"],
    ["ip", "on_block_list", null, "block_list"],
    ["phone", "one_of", ["0551234567"], "submission"],
    ["pieces", "at_least", 1, "submission"],
    ["delivered_before", "at_least", 1, "history"],
    ["returned_before", "at_least", 1, "history"],
  ])("%s %s reads %s", (key, op, value, source) => {
    expect(sourceOf(parsed(key, op, value))).toBe(source);
  });

  it("covers every Condition in the catalogue", () => {
    expect(Object.keys(CONDITIONS).sort()).toEqual([...CONDITION_KEYS].sort());
  });
});

describe("Conditions on how an order was sent", () => {
  it.each([
    ["network_country", "one_of", ["Algeria"]],
    ["network_country", "one_of", ["D"]],
    ["visit_source", "one_of", ["radio"]],
    ["app_source", "one_of", ["safari"]],
    ["visit_source", "not_one_of", ["meta"]],
    ["app_source", "not_one_of", ["browser"]],
    ["fill_seconds", "at_least", 1],
    ["network_operator", "contains_any", ["djezzy"]],
  ])("refuses %s %s %j", (key, op, value) => {
    expect(parseCondition({ key, op, value }).ok).toBe(false);
  });

  it("keeps a country in capitals", () => {
    expect(parsed("network_country", "one_of", [" dz "]).value).toEqual(["DZ"]);
  });
});

describe("parseCondition", () => {
  it.each([
    [null, "NOT_AN_OBJECT"],
    [[], "NOT_AN_OBJECT"],
    [{ key: "pieces", op: "at_least", value: 1, extra: 1 }, "UNKNOWN_KEY"],
    [{ key: "nope", op: "at_least", value: 1 }, "UNKNOWN_CONDITION"],
    [{ key: "pieces", op: "one_of", value: [1] }, "INVALID_OPERATOR"],
    [{ key: "name", op: "on_block_list", value: null }, "INVALID_OPERATOR"],
    [{ key: "pieces", op: "at_least", value: 0 }, "INVALID_VALUE"],
    [{ key: "pieces", op: "at_least", value: 1.5 }, "INVALID_VALUE"],
    [{ key: "pieces", op: "at_least", value: "2" }, "INVALID_VALUE"],
    [{ key: "pieces", op: "at_most", value: -1 }, "INVALID_VALUE"],
    [{ key: "pieces", op: "at_most", value: RULE_LIMITS.number + 1 }, "INVALID_VALUE"],
    [{ key: "name", op: "shorter_than", value: 0 }, "INVALID_VALUE"],
    [{ key: "phone_orders", op: "at_least_in_window", value: { count: 0, windowHours: 24 } }, "INVALID_VALUE"],
    [{ key: "phone_orders", op: "at_least_in_window", value: { count: 1, windowHours: 5 } }, "INVALID_VALUE"],
    [{ key: "phone_orders", op: "at_least_in_window", value: 3 }, "INVALID_VALUE"],
    [{ key: "ip_burst", op: "is_true", value: 1 }, "INVALID_VALUE"],
    [{ key: "wilaya", op: "one_of", value: [] }, "INVALID_VALUE"],
    [{ key: "wilaya", op: "one_of", value: [70] }, "INVALID_VALUE"],
    [{ key: "wilaya", op: "one_of", value: [0] }, "INVALID_VALUE"],
    [{ key: "wilaya", op: "one_of", value: ["16"] }, "INVALID_VALUE"],
    [{ key: "delivery_type", op: "one_of", value: ["drone"] }, "INVALID_VALUE"],
    [{ key: "ip", op: "one_of", value: ["not an ip"] }, "INVALID_VALUE"],
    [{ key: "phone", op: "one_of", value: ["abc"] }, "INVALID_VALUE"],
    [{ key: "phone", op: "starts_with", value: ["05a"] }, "INVALID_VALUE"],
    [{ key: "name", op: "contains_any", value: ["  "] }, "INVALID_VALUE"],
    [{ key: "name", op: "contains_any", value: ["x".repeat(RULE_LIMITS.textLength + 1)] }, "INVALID_VALUE"],
    [{ key: "name", op: "contains_any", value: Array.from({ length: RULE_LIMITS.listValues + 1 }, (_, i) => `v${i}`) }, "INVALID_VALUE"],
  ])("refuses %j with %s", (input, code) => {
    expect(parseCondition(input)).toEqual({ ok: false, code });
  });

  it("keeps values in the form they are compared in", () => {
    expect(parsed("phone", "one_of", ["+213 551 234 567", "0551234567"]).value).toEqual(["0551234567"]);
    expect(parsed("name", "contains_any", ["  TEST   Order "]).value).toEqual(["test order"]);
    expect(parsed("ip", "one_of", ["2001:db8:1:2:aaaa:bbbb:cccc:dddd"]).value).toEqual(["2001:db8:1:2::/64"]);
    expect(parsed("ip_burst", "is_true", undefined).value).toBeNull();
  });

  it("accepts the limits themselves", () => {
    expect(parsed("wilaya", "one_of", [1, 69]).value).toEqual([1, 69]);
    expect(parsed("pieces", "at_most", 0).value).toBe(0);
    expect(parsed("pieces", "at_least", RULE_LIMITS.number).value).toBe(RULE_LIMITS.number);
    expect(parsed("name", "contains_any", ["x".repeat(RULE_LIMITS.textLength)]).value).toHaveLength(1);
  });
});

describe("parseRule", () => {
  const good = { name: " Too many ", mode: "trial", action: "flag", conditions: [{ key: "pieces", op: "at_least", value: 5 }] };

  it("takes a rule it fully understands", () => {
    expect(parseRule(good)).toEqual({ ok: true, rule: { name: "Too many", mode: "trial", action: "flag", conditions: [{ key: "pieces", op: "at_least", value: 5 }] } });
  });

  it.each([
    ["a list", [], "NOT_AN_OBJECT"],
    ["an extra field", { ...good, id: "x" }, "UNKNOWN_KEY"],
    ["no name", { ...good, name: "   " }, "INVALID_NAME"],
    ["a long name", { ...good, name: "x".repeat(RULE_LIMITS.nameLength + 1) }, "INVALID_NAME"],
    ["an unknown mode", { ...good, mode: "paused" }, "INVALID_MODE"],
    ["an unknown action", { ...good, action: "delete" }, "INVALID_ACTION"],
    ["no conditions", { ...good, conditions: [] }, "NO_CONDITIONS"],
    ["conditions that are not a list", { ...good, conditions: {} }, "NO_CONDITIONS"],
    ["too many conditions", { ...good, conditions: Array(RULE_LIMITS.conditions + 1).fill(good.conditions[0]) }, "TOO_MANY_CONDITIONS"],
  ])("refuses %s", (_label, input, code) => {
    expect(parseRule(input)).toMatchObject({ ok: false, code });
  });

  it("says which Condition it refused", () => {
    expect(parseRule({ ...good, conditions: [good.conditions[0], { key: "nope", op: "x", value: 1 }] })).toEqual({ ok: false, code: "UNKNOWN_CONDITION", conditionIndex: 1 });
  });

  it("takes as many conditions as the limit", () => {
    expect(parseRule({ ...good, conditions: Array(RULE_LIMITS.conditions).fill(good.conditions[0]) }).ok).toBe(true);
  });
});

describe("readStoredConditions", () => {
  it("reads good ones and gives null for anything it cannot read", () => {
    expect(readStoredConditions(JSON.stringify([{ key: "pieces", op: "at_least", value: 2 }]))).toEqual([{ key: "pieces", op: "at_least", value: 2 }]);
    expect(readStoredConditions("{not json")).toBeNull();
    expect(readStoredConditions("{}")).toBeNull();
    expect(readStoredConditions("[]")).toBeNull();
    expect(readStoredConditions(JSON.stringify([{ key: "pieces", op: "at_least", value: 2 }, { key: "gone", op: "x", value: 1 }]))).toBeNull();
  });
});

describe("decide", () => {
  it("accepts when nothing matches", () => {
    expect(decide([rule("spam", "active", [no])], FACTS)).toEqual({ verdict: "accept", matches: [] });
    expect(decide([], FACTS)).toEqual({ verdict: "accept", matches: [] });
  });

  it("needs every Condition of a rule", () => {
    expect(decide([rule("spam", "active", [yes, no])], FACTS).verdict).toBe("accept");
    expect(decide([rule("spam", "active", [yes, yes])], FACTS).verdict).toBe("spam");
  });

  it("never matches a rule with no Conditions", () => {
    expect(decide([rule("spam", "active", [])], FACTS)).toEqual({ verdict: "accept", matches: [] });
  });

  it("gives each action its own Verdict", () => {
    expect(decide([rule("spam", "active", [yes])], FACTS).verdict).toBe("spam");
    expect(decide([rule("flag", "active", [yes])], FACTS).verdict).toBe("flag");
    expect(decide([rule("accept", "active", [yes])], FACTS).verdict).toBe("accept");
  });

  it("lets a Trial rule change nothing, and records it", () => {
    const trial = rule("spam", "trial", [yes]);
    expect(decide([trial], FACTS)).toEqual({ verdict: "accept", matches: [{ ruleId: trial.id, name: trial.name, mode: "trial", action: "spam" }] });
  });

  it("ignores a rule that is Off", () => {
    expect(decide([rule("spam", "off", [yes])], FACTS)).toEqual({ verdict: "accept", matches: [] });
  });

  it("records every match, whatever decided", () => {
    const decision = decide([rule("flag", "active", [yes]), rule("spam", "trial", [yes]), rule("spam", "active", [no])], FACTS);
    expect(decision.verdict).toBe("flag");
    expect(decision.matches.map((match) => match.mode)).toEqual(["active", "trial"]);
  });

  describe("precedence, whatever the order of the rules", () => {
    const both = <T>(a: T, b: T) => [[a, b], [b, a]];

    it.each(both("accept", "spam"))("Always accept beats To Spam (%s, %s)", (a, b) => {
      expect(decide([rule(a as RuleAction, "active", [yes]), rule(b as RuleAction, "active", [yes])], FACTS).verdict).toBe("accept");
    });

    it.each(both("spam", "flag"))("To Spam beats Flag (%s, %s)", (a, b) => {
      expect(decide([rule(a as RuleAction, "active", [yes]), rule(b as RuleAction, "active", [yes])], FACTS).verdict).toBe("spam");
    });

    it.each(both("accept", "flag"))("Always accept beats Flag (%s, %s)", (a, b) => {
      expect(decide([rule(a as RuleAction, "active", [yes]), rule(b as RuleAction, "active", [yes])], FACTS).verdict).toBe("accept");
    });

  });

  describe("the Block List, which needs no rule", () => {
    const onList = (blocked: Facts["blocked"]): Facts => ({ ...FACTS, blocked });
    const PHONE = { ruleId: "block-list:phone", name: "Block List", mode: "active", action: "spam", blockList: "phone" };
    const IP = { ruleId: "block-list:ip", name: "Block List", mode: "active", action: "spam", blockList: "ip" };

    it("sends a blocked number to Spam with no rule at all", () => {
      expect(decide([], onList({ phone: true, ip: false }))).toEqual({ verdict: "spam", matches: [PHONE] });
    });

    it("sends a blocked network to Spam, and says which of the two was blocked", () => {
      expect(decide([], onList({ phone: false, ip: true }))).toEqual({ verdict: "spam", matches: [IP] });
      expect(decide([], onList({ phone: true, ip: true })).matches).toEqual([PHONE, IP]);
    });

    it("beats Always accept, and still records every rule that matched", () => {
      const accept = rule("accept", "active", [yes]);
      const trial = rule("flag", "trial", [yes]);
      const decision = decide([accept, trial], onList({ phone: true, ip: false }));
      expect(decision.verdict).toBe("spam");
      expect(decision.matches.map((match) => match.ruleId)).toEqual(["block-list:phone", accept.id, trial.id]);
    });

    it("does nothing for a number that is not on it", () => {
      expect(decide([], onList({ phone: false, ip: false }))).toEqual({ verdict: "accept", matches: [] });
      expect(decide([], FACTS)).toEqual({ verdict: "accept", matches: [] });
    });

    it("no longer runs an old rule that only asks the Block List", () => {
      expect(readsOnlyBlockList([blockedPhone])).toBe(true);
      expect(readsOnlyBlockList([blockedPhone, yes])).toBe(false);
      expect(readsOnlyBlockList([])).toBe(false);
      expect(decide([rule("spam", "active", [blockedPhone])], onList({ phone: true, ip: false })).matches).toEqual([PHONE]);
      expect(decide([rule("accept", "active", [blockedPhone])], onList({ phone: false, ip: false })).matches).toEqual([]);
    });
  });

  it("names the template rule a match came from, so it reads in each language", () => {
    const fromTemplate = { ...rule("flag", "active", [yes]), templateRule: "same_phone" as const };
    const ownRule = { ...rule("flag", "active", [yes]), templateRule: null };
    expect(decide([fromTemplate, ownRule], FACTS).matches).toEqual([
      { ruleId: fromTemplate.id, name: fromTemplate.name, mode: "active", action: "flag", template: "same_phone" },
      { ruleId: ownRule.id, name: ownRule.name, mode: "active", action: "flag" },
    ]);
  });
});

describe("ipKey", () => {
  it.each([
    ["41.100.1.1", "41.100.1.1"],
    [" 41.100.1.1 ", "41.100.1.1"],
    ["::ffff:41.100.1.1", "41.100.1.1"],
    ["2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2:1111:2222:3333:4444", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
  ])("%s is %s", (raw, key) => {
    expect(ipKey(raw)).toBe(key);
  });

  it("puts two addresses of one IPv6 network together and two networks apart", () => {
    expect(ipKey("2001:db8:1:2::a")).toBe(ipKey("2001:db8:1:2::b"));
    expect(ipKey("2001:db8:1:3::a")).not.toBe(ipKey("2001:db8:1:2::a"));
  });

  it.each(["", "not an ip", "256.1.1.1", "1.2.3", "1:2:3", "1::2::3", "12345::1", "1:2:3:4:5:6:7:8:9", "::ffff:999.1.1.1"])("refuses %j", (raw) => {
    expect(ipKey(raw)).toBeNull();
  });
});

describe("Templates", () => {
  it("defaults to a real Template", () => {
    expect(TEMPLATE_KEYS).toContain(DEFAULT_TEMPLATE);
  });

  it.each(TEMPLATE_KEYS.flatMap((key) => (["en", "fr", "ar"] as const).map((locale) => [key, locale] as const)))("%s in %s is made of rules a person could write", (key, locale) => {
    for (const { templateRule, ...draft } of templateRules(key, locale)) {
      expect(isTemplateRuleKey(templateRule)).toBe(true);
      expect(parseRule(JSON.parse(JSON.stringify(draft)))).toEqual({ ok: true, rule: JSON.parse(JSON.stringify(draft)) });
    }
  });

  it("keeps network rules from sending to Spam on their own in the default", () => {
    expect(TEMPLATES.recommended.find((rule) => rule.key === "same_ip")).toMatchObject({ action: "flag" });
    expect(TEMPLATES.under_attack.find((rule) => rule.key === "same_ip")).toMatchObject({ action: "flag" });
  });

  it("acts by default only on proven customers: the Block List needs no rule", () => {
    const active = TEMPLATES.recommended.filter((rule) => rule.mode === "active").map((rule) => rule.key);
    expect(active).toEqual(["good_customer"]);
    for (const key of TEMPLATE_KEYS) expect(templateRules(key, "en").some((draft) => readsOnlyBlockList(draft.conditions))).toBe(false);
  });

  it("never acts in the default on what only a browser says", () => {
    for (const key of ["same_device", "many_numbers", "fast_fill"] as const) {
      expect(TEMPLATES.recommended.find((rule) => rule.key === key)).toMatchObject({ action: "flag", mode: "trial" });
    }
  });

  it("sends many numbers on one device to Spam under attack, and only flags the rest", () => {
    expect(TEMPLATES.under_attack.find((rule) => rule.key === "many_numbers")).toMatchObject({ action: "spam", mode: "active" });
    expect(TEMPLATES.under_attack.find((rule) => rule.key === "same_device")).toMatchObject({ action: "flag", mode: "active" });
    expect(TEMPLATES.under_attack.find((rule) => rule.key === "fast_fill")).toMatchObject({ action: "flag", mode: "active" });
  });

  it("names rules in the store's language, and knows each name in every language", () => {
    expect(templateRules("recommended", "ar")[0]).toMatchObject({ templateRule: "good_customer", name: "زبائن استلموا طلبًا" });
    expect(templateRules("recommended", "fr")[0].name).toBe("Clients déjà livrés");
    expect(templateRuleName("good_customer", "en")).toBe("Customers who received an order");
    expect(isTemplateName("good_customer", " Clients déjà livrés ")).toBe(true);
    expect(isTemplateName("good_customer", "زبائن استلموا طلبًا")).toBe(true);
    expect(isTemplateName("good_customer", "My good customers")).toBe(false);
    expect(isTemplateName("same_phone", "Clients déjà livrés")).toBe(false);
  });

  it("knows exactly its own rule keys", () => {
    expect(TEMPLATE_RULE_KEYS).toEqual(["good_customer", "same_phone", "same_ip", "burst", "same_device", "many_numbers", "fast_fill", "returner"]);
    expect(isTemplateRuleKey("same_phone")).toBe(true);
    expect(isTemplateRuleKey("blocked_phone")).toBe(false);
    expect(isTemplateRuleKey(7)).toBe(false);
  });

  it("adds nothing for Start empty", () => {
    expect(templateRules("empty", "en")).toEqual([]);
  });
});
