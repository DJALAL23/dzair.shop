import type { AttemptSignals } from "../../../../../cod-shared/order-screening/facts";
import { apiFetch } from "@/lib/api";
import { appRequest } from "@/features/apps/api";
import type { Condition, RuleAction, RuleMode } from "../../../../../cod-shared/order-screening/conditions";
import type { RuleDraft, RuleMatch } from "../../../../../cod-shared/order-screening/rules";
import type { BlockListKind, OrderAttemptOutcome } from "../../../../../cod-shared/order-screening/signals";
import type { TemplateKey } from "../../../../../cod-shared/order-screening/templates";

const KEY = "order-protection";
const BASE = `/api/apps/${KEY}`;

export interface ProtectionRule {
  id: string;
  name: string;
  mode: RuleMode;
  action: RuleAction;
  conditions: Condition[] | null;
  templateKey: string | null;
  matchesLastWeek: number;
}

export interface ProtectionState {
  enabled: boolean | null;
  rules: ProtectionRule[];
}

export interface BlockEntry {
  id: string;
  kind: BlockListKind;
  value: string;
  note: string | null;
  createdAt: string;
}

export interface OrderAttempt {
  id: string;
  createdAt: string;
  phone: string;
  ipKey: string | null;
  outcome: OrderAttemptOutcome;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  total: number | null;
  matches: RuleMatch[];
  signals: AttemptSignals;
}

export interface Page<T> {
  data: T[];
  total: number;
}

export const getProtection = () => appRequest<ProtectionState>(KEY, "", "GET");
export const setProtectionEnabled = (enabled: boolean) => appRequest<{ enabled: boolean }>(KEY, "", "PUT", { enabled });
export const chooseTemplate = (key: TemplateKey) => appRequest<ProtectionState>(KEY, "/template", "POST", { key });

export const createRule = (rule: RuleDraft) => appRequest<ProtectionRule>(KEY, "/rules", "POST", rule);
export const updateRule = (id: string, rule: RuleDraft) => appRequest<ProtectionRule>(KEY, `/rules/${id}`, "PUT", rule);
export const setRuleMode = (id: string, mode: RuleMode) => appRequest<ProtectionRule>(KEY, `/rules/${id}/mode`, "PATCH", { mode });
export const deleteRule = (id: string) => appRequest<unknown>(KEY, `/rules/${id}`, "DELETE");

export const listBlockList = (params: { limit: number; offset: number }) => apiFetch<Page<BlockEntry>>(`${BASE}/block-list?limit=${params.limit}&offset=${params.offset}`);
export const addToBlockList = (entry: { kind: BlockListKind; value: string; note?: string }) => appRequest<BlockEntry>(KEY, "/block-list", "POST", entry);
export const removeFromBlockList = (id: string) => appRequest<unknown>(KEY, `/block-list/${id}`, "DELETE");

export function listAttempts(params: { outcome?: OrderAttemptOutcome; limit: number; offset: number }) {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.outcome) query.set("outcome", params.outcome);
  return apiFetch<Page<OrderAttempt>>(`${BASE}/attempts?${query}`);
}

export const attemptOfOrder = (orderId: string) => appRequest<OrderAttempt | null>(KEY, `/orders/${orderId}`, "GET");
export const rescueSpamOrder = (id: string) => appRequest<{ orderId: string; orderNumber: string }>(KEY, `/spam/${id}/rescue`, "POST");
export const deleteSpamOrder = (id: string) => appRequest<unknown>(KEY, `/spam/${id}`, "DELETE");
