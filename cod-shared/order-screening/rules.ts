import { conditionHolds, parseCondition, RULE_ACTIONS, RULE_LIMITS, RULE_MODES, usesBlockList, type Condition, type ConditionIssueCode, type Facts, type RuleAction, type RuleMode } from "./conditions";
import { BLOCK_LIST_KINDS, type BlockListKind } from "./signals";
import type { TemplateRuleKey } from "./templates";

export interface RuleDraft {
  name: string;
  mode: RuleMode;
  action: RuleAction;
  conditions: Condition[];
}

export interface Rule extends RuleDraft {
  id: string;
  templateRule?: TemplateRuleKey | null;
}

export type RuleIssueCode = "NOT_AN_OBJECT" | "UNKNOWN_KEY" | "INVALID_NAME" | "INVALID_MODE" | "INVALID_ACTION" | "NO_CONDITIONS" | "TOO_MANY_CONDITIONS" | ConditionIssueCode;

export type ParsedRule = { ok: true; rule: RuleDraft } | { ok: false; code: RuleIssueCode; conditionIndex?: number };

const FIELDS = ["name", "mode", "action", "conditions"];

/** A rule from a person: refused unless every part of it is understood. */
export function parseRule(input: unknown): ParsedRule {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, code: "NOT_AN_OBJECT" };
  const draft = input as Record<string, unknown>;
  if (Object.keys(draft).some((field) => !FIELDS.includes(field))) return { ok: false, code: "UNKNOWN_KEY" };
  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (name.length === 0 || name.length > RULE_LIMITS.nameLength) return { ok: false, code: "INVALID_NAME" };
  if (!(RULE_MODES as readonly unknown[]).includes(draft.mode)) return { ok: false, code: "INVALID_MODE" };
  if (!(RULE_ACTIONS as readonly unknown[]).includes(draft.action)) return { ok: false, code: "INVALID_ACTION" };
  if (!Array.isArray(draft.conditions) || draft.conditions.length === 0) return { ok: false, code: "NO_CONDITIONS" };
  if (draft.conditions.length > RULE_LIMITS.conditions) return { ok: false, code: "TOO_MANY_CONDITIONS" };
  const conditions: Condition[] = [];
  for (const [conditionIndex, raw] of draft.conditions.entries()) {
    const parsed = parseCondition(raw);
    if (!parsed.ok) return { ok: false, code: parsed.code, conditionIndex };
    conditions.push(parsed.condition);
  }
  return { ok: true, rule: { name, mode: draft.mode as RuleMode, action: draft.action as RuleAction, conditions } };
}

/** A stored rule's Conditions, or null when any of them cannot be read: that rule is skipped, the others still run. */
export function readStoredConditions(json: string): Condition[] | null {
  let stored: unknown;
  try {
    stored = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const conditions: Condition[] = [];
  for (const raw of stored) {
    const parsed = parseCondition(raw);
    if (!parsed.ok) return null;
    conditions.push(parsed.condition);
  }
  return conditions;
}

export type Verdict = "accept" | "flag" | "spam";

export interface RuleMatch {
  ruleId: string;
  name: string;
  mode: "trial" | "active";
  action: RuleAction;
  /** The template rule it came from, unrenamed: its name is shown in the reader's language. */
  template?: TemplateRuleKey;
  /** Set on the match the Block List itself makes. */
  blockList?: BlockListKind;
}

export interface Decision {
  verdict: Verdict;
  matches: RuleMatch[];
}

const matched = (rule: Rule, facts: Facts) => rule.conditions.length > 0 && rule.conditions.every((condition) => conditionHolds(condition, facts));

/** A rule that only asks the Block List: the Block List acts on its own, so such a rule no longer runs or shows. */
export const readsOnlyBlockList = (conditions: readonly Condition[]) => conditions.length > 0 && conditions.every(usesBlockList);

const BLOCK_LIST_NAME = "Block List";

function blockListMatches(facts: Facts): RuleMatch[] {
  return BLOCK_LIST_KINDS.filter((kind) => facts.blocked?.[kind]).map((kind) => ({ ruleId: `block-list:${kind}`, name: BLOCK_LIST_NAME, mode: "active", action: "spam", blockList: kind }));
}

const RANK: Record<RuleAction, number> = { accept: 1, spam: 2, flag: 3 };
const VERDICT_OF: Record<RuleAction, Verdict> = { accept: "accept", spam: "spam", flag: "flag" };

/**
 * The Verdict on an attempt. The Block List comes first: what the merchant blocked goes to Spam,
 * whatever the rules say. Then only Active rules decide — Accept, then Spam, then Flag; Trial rules are recorded.
 */
export function decide(rules: readonly Rule[], facts: Facts): Decision {
  const blocked = blockListMatches(facts);
  const hits = rules.filter((rule) => rule.mode !== "off" && !readsOnlyBlockList(rule.conditions) && matched(rule, facts));
  const matches = [
    ...blocked,
    ...hits.map((rule): RuleMatch => ({ ruleId: rule.id, name: rule.name, mode: rule.mode as RuleMatch["mode"], action: rule.action, ...(rule.templateRule ? { template: rule.templateRule } : {}) })),
  ];
  if (blocked.length > 0) return { verdict: "spam", matches };
  const deciding = hits.filter((rule) => rule.mode === "active").sort((a, b) => RANK[a.action] - RANK[b.action])[0];
  return { verdict: deciding ? VERDICT_OF[deciding.action] : "accept", matches };
}
