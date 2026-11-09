import { ipKey, phoneKey } from "./signals";

export const RULE_MODES = ["trial", "active", "off"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export const RULE_ACTIONS = ["spam", "flag", "accept"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const WINDOW_HOURS = [1, 6, 24, 72, 168, 720] as const;

export const RULE_LIMITS = { rules: 30, conditions: 5, nameLength: 80, listValues: 200, textLength: 100, number: 100_000, blockList: 5_000 } as const;

export const CONDITION_KEYS = [
  "phone_orders",
  "ip_orders",
  "ip_burst",
  "phone",
  "ip",
  "name",
  "address",
  "wilaya",
  "product",
  "pieces",
  "delivery_type",
  "delivered_before",
  "returned_before",
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export const OPERATORS = ["at_least_in_window", "at_least", "at_most", "is_true", "on_block_list", "one_of", "not_one_of", "starts_with", "contains_any", "shorter_than"] as const;
export type Operator = (typeof OPERATORS)[number];

export interface WindowValue {
  count: number;
  windowHours: number;
}
export type ListValue = readonly (string | number)[];
export type ConditionValue = null | number | ListValue | WindowValue;

export interface Condition {
  key: ConditionKey;
  op: Operator;
  value: ConditionValue;
}

/** What is known about an Order Attempt. A Signal left undefined means no data, and no Condition on it holds. */
export interface Facts {
  phone: string;
  ipKey?: string;
  name: string;
  address?: string;
  wilayaId: number;
  productIds: readonly string[];
  pieces: number;
  deliveryType: "home" | "stop_desk";
  windowCounts?: Readonly<Record<string, number>>;
  blocked?: { phone: boolean; ip: boolean };
  history?: { delivered: number; returned: number };
  burst?: boolean;
}

export type FactSource = "submission" | "attempts" | "history" | "block_list" | "burst";

export type ValueShape = "none" | "number" | "window" | "list";

const asList = (fact: unknown): readonly unknown[] => (Array.isArray(fact) ? fact : [fact]);
const normalizedText = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

interface OperatorSpec {
  shape: ValueShape;
  min?: number;
  holds(fact: unknown, value: never): boolean;
}

const OPERATOR_SPECS: Record<Operator, OperatorSpec> = {
  at_least_in_window: { shape: "window", holds: (fact: number, value: WindowValue) => fact >= value.count },
  at_least: { shape: "number", min: 1, holds: (fact: number, value: number) => fact >= value },
  at_most: { shape: "number", min: 0, holds: (fact: number, value: number) => fact <= value },
  is_true: { shape: "none", holds: (fact: boolean) => fact === true },
  on_block_list: { shape: "none", holds: (fact: boolean) => fact === true },
  one_of: { shape: "list", holds: (fact: unknown, value: ListValue) => asList(fact).some((item) => value.includes(item as string | number)) },
  not_one_of: { shape: "list", holds: (fact: unknown, value: ListValue) => !asList(fact).some((item) => value.includes(item as string | number)) },
  starts_with: { shape: "list", holds: (fact: string, value: readonly string[]) => value.some((prefix) => fact.startsWith(prefix)) },
  contains_any: { shape: "list", holds: (fact: string, value: readonly string[]) => value.some((part) => normalizedText(fact).includes(part)) },
  shorter_than: { shape: "number", min: 1, holds: (fact: string, value: number) => normalizedText(fact).length < value },
};

export const windowCountKey = (key: ConditionKey, windowHours: number) => `${key}:${windowHours}`;

type ListItem = (raw: unknown, op: Operator) => string | number | null;

export interface ConditionSpec {
  group: "who" | "typed";
  operators: readonly Operator[];
  source: FactSource;
  fact(facts: Facts, condition: Condition): unknown;
  item?: ListItem;
  /** The fixed choices of a list, when it has any. */
  options?: readonly string[];
}

const trimmed = (raw: unknown) => (typeof raw === "string" && raw.trim().length > 0 && raw.trim().length <= RULE_LIMITS.textLength ? raw.trim() : null);

const phoneItem: ListItem = (raw, op) => {
  const text = trimmed(raw);
  if (text === null) return null;
  if (op === "starts_with") return /^\+?\d{1,15}$/.test(text) ? text : null;
  return phoneKey(text);
};
const ipItem: ListItem = (raw) => (typeof raw === "string" ? ipKey(raw) : null);
const textItem: ListItem = (raw) => {
  const text = trimmed(raw);
  return text === null ? null : normalizedText(text);
};
const wilayaItem: ListItem = (raw) => (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 69 ? raw : null);
const idItem: ListItem = (raw) => trimmed(raw);

const DELIVERY_TYPES = ["home", "stop_desk"] as const;

const counted = (key: ConditionKey): ConditionSpec => ({
  group: "who",
  operators: ["at_least_in_window"],
  source: "attempts",
  fact: (facts, condition) => facts.windowCounts?.[windowCountKey(key, (condition.value as WindowValue).windowHours)],
});

const quantity = (fact: ConditionSpec["fact"], source: FactSource): ConditionSpec => ({ group: "typed", operators: ["at_least", "at_most"], source, fact });

const onList = (fact: ConditionSpec["fact"], blocked: "phone" | "ip"): ConditionSpec["fact"] => (facts, condition) =>
  condition.op === "on_block_list" ? facts.blocked?.[blocked] : fact(facts, condition);

const wording = (fact: ConditionSpec["fact"]): ConditionSpec => ({ group: "typed", operators: ["contains_any", "shorter_than"], source: "submission", fact, item: textItem });

export const CONDITIONS: Readonly<Record<ConditionKey, ConditionSpec>> = {
  phone_orders: counted("phone_orders"),
  ip_orders: counted("ip_orders"),
  ip_burst: { group: "who", operators: ["is_true"], source: "burst", fact: (facts) => facts.burst },
  phone: { group: "typed", operators: ["on_block_list", "one_of", "starts_with"], source: "submission", fact: onList((facts) => facts.phone, "phone"), item: phoneItem },
  ip: { group: "who", operators: ["on_block_list", "one_of"], source: "submission", fact: onList((facts) => facts.ipKey, "ip"), item: ipItem },
  name: wording((facts) => facts.name),
  address: wording((facts) => facts.address),
  wilaya: { group: "typed", operators: ["one_of", "not_one_of"], source: "submission", fact: (facts) => facts.wilayaId, item: wilayaItem },
  product: { group: "typed", operators: ["one_of"], source: "submission", fact: (facts) => facts.productIds, item: idItem },
  pieces: quantity((facts) => facts.pieces, "submission"),
  delivery_type: { group: "typed", operators: ["one_of"], source: "submission", fact: (facts) => facts.deliveryType, options: DELIVERY_TYPES },
  delivered_before: quantity((facts) => facts.history?.delivered, "history"),
  returned_before: quantity((facts) => facts.history?.returned, "history"),
};

/** Where a Condition's data comes from: a Block List operator reads the list, whatever the Condition. */
export function sourceOf(condition: Condition): FactSource {
  return condition.op === "on_block_list" ? "block_list" : CONDITIONS[condition.key].source;
}

export function usesBlockList(condition: Condition): boolean {
  return condition.op === "on_block_list";
}

export function valueShape(op: Operator): ValueShape {
  return OPERATOR_SPECS[op].shape;
}

/** Whether the Condition holds. No data never holds, on any operator. */
export function conditionHolds(condition: Condition, facts: Facts): boolean {
  const fact = CONDITIONS[condition.key].fact(facts, condition);
  if (fact === undefined || fact === null) return false;
  return OPERATOR_SPECS[condition.op].holds(fact, condition.value as never);
}

export type ConditionIssueCode = "NOT_AN_OBJECT" | "UNKNOWN_KEY" | "UNKNOWN_CONDITION" | "INVALID_OPERATOR" | "INVALID_VALUE";

export type ParsedCondition = { ok: true; condition: Condition } | { ok: false; code: ConditionIssueCode };

const isRecord = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);

function wholeNumber(raw: unknown, min: number): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= RULE_LIMITS.number ? raw : null;
}

function parseList(raw: unknown, spec: ConditionSpec, op: Operator): ListValue | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RULE_LIMITS.listValues) return null;
  const item: ListItem = spec.options ? (value) => (typeof value === "string" && spec.options!.includes(value) ? value : null) : spec.item!;
  const items = raw.map((value) => item(value, op));
  return items.includes(null) ? null : [...new Set(items as (string | number)[])];
}

function parseValue(raw: unknown, spec: ConditionSpec, op: Operator): ConditionValue | undefined {
  const operator = OPERATOR_SPECS[op];
  switch (operator.shape) {
    case "none":
      return raw === null || raw === undefined ? null : undefined;
    case "number":
      return wholeNumber(raw, operator.min ?? 0) ?? undefined;
    case "window": {
      if (!isRecord(raw)) return undefined;
      const count = wholeNumber(raw.count, 1);
      const windowHours = raw.windowHours;
      if (count === null || !(WINDOW_HOURS as readonly unknown[]).includes(windowHours)) return undefined;
      return { count, windowHours: windowHours as number };
    }
    case "list":
      return parseList(raw, spec, op) ?? undefined;
  }
}

/** One Condition, refused unless every part of it is understood. Values come back in the form they are compared in. */
export function parseCondition(input: unknown): ParsedCondition {
  if (!isRecord(input)) return { ok: false, code: "NOT_AN_OBJECT" };
  if (Object.keys(input).some((name) => !["key", "op", "value"].includes(name))) return { ok: false, code: "UNKNOWN_KEY" };
  if (!(CONDITION_KEYS as readonly unknown[]).includes(input.key)) return { ok: false, code: "UNKNOWN_CONDITION" };
  const key = input.key as ConditionKey;
  const spec = CONDITIONS[key];
  if (!(spec.operators as readonly unknown[]).includes(input.op)) return { ok: false, code: "INVALID_OPERATOR" };
  const op = input.op as Operator;
  const value = parseValue(input.value, spec, op);
  if (value === undefined) return { ok: false, code: "INVALID_VALUE" };
  return { ok: true, condition: { key, op, value } };
}
